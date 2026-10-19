//! The daemon's event handling: glues the pure [`Controller`] to MQTT, the
//! Unix socket and the files on disk. Synchronous and clock-injected, so the
//! whole flow (messages in → commands out) is unit-tested; `main.rs` only owns
//! the timers and the event loop.

use chrono::{DateTime, TimeZone, Utc};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

use crate::config::HeatlinkConfig;
use crate::control::{Controller, Demand, Mode, PiState};
use crate::link::Link;
use crate::messages::{self, Inbound, Topics};
use crate::mqtt::MqttSink;
use crate::sensor::SensorReading;
use crate::socket;

pub struct Daemon<Tz: TimeZone> {
    ctl: Controller<Tz>,
    sink: Arc<dyn MqttSink>,
    topics: Topics,
    heatlink: HeatlinkConfig,
    schedule_path: PathBuf,
    state_path: PathBuf,
    lines: broadcast::Sender<String>,
    /// Readings are published (MQTT + socket) only once the ENS160 has warmed
    /// up; the controller uses the temperature from the first reading.
    publish_readings: bool,
    last_sent: Option<Demand>,
    last_state_key: Option<PiState>,
    /// MQTT connection state: nothing is published while disconnected.
    link: Link,
    /// False on a mock-sensor build unless `allow_mock_demand` is set: a fake
    /// temperature must never drive the real boiler.
    demand_allowed: bool,
    demand_refusal_logged: bool,
}

impl<Tz: TimeZone> Daemon<Tz> {
    pub fn new(
        ctl: Controller<Tz>,
        sink: Arc<dyn MqttSink>,
        topics: Topics,
        heatlink: HeatlinkConfig,
        schedule_path: PathBuf,
        state_path: PathBuf,
        lines: broadcast::Sender<String>,
    ) -> Self {
        Self {
            ctl,
            sink,
            topics,
            heatlink,
            schedule_path,
            state_path,
            lines,
            publish_readings: false,
            last_sent: None,
            last_state_key: None,
            link: Link::default(),
            demand_allowed: true,
            demand_refusal_logged: false,
        }
    }

    pub fn set_publish_readings(&mut self, on: bool) {
        self.publish_readings = on;
    }

    pub fn set_demand_allowed(&mut self, allowed: bool) {
        self.demand_allowed = allowed;
    }

    /// Publish if the link is up; otherwise drop the message. Everything the
    /// daemon publishes is periodic or re-sent once the link is back, and a
    /// queued backlog would only replay stale state.
    fn publish(&self, topic: &str, payload: &str) {
        if !self.link.connected() {
            debug!("MQTT down; dropped publish to {topic}");
            return;
        }
        if let Err(e) = self.sink.publish(topic, payload) {
            warn!("MQTT publish to {topic} failed: {e:#}");
        }
    }

    fn persist(&self) {
        if let Err(e) = self.ctl.persisted().save(&self.state_path) {
            warn!("Saving control state failed: {e:#}");
        }
    }

    fn send_demand(&mut self, d: Demand, now: DateTime<Utc>) {
        self.last_sent = Some(d);
        if !self.demand_allowed {
            if !self.demand_refusal_logged {
                error!(
                    "Mock sensor build: not sending demand to the heatlink \
                     (set control.allow_mock_demand for bench testing)"
                );
                self.demand_refusal_logged = true;
            }
            return;
        }
        let payload = messages::demand_command(&d, self.heatlink.demand_ttl_s, now);
        self.publish(&self.topics.heatlink_commands, &payload);
    }

    fn send_state(&mut self, now: DateTime<Utc>) {
        let state = self.ctl.state(now);
        match serde_json::to_string(&state) {
            Ok(payload) => self.publish(&self.topics.pi_state, &payload),
            Err(e) => warn!("Serialising pi/state failed: {e}"),
        }
        let _ = self.lines.send(socket::state_line(&state));
        self.last_state_key = Some(state.change_key());
    }

    fn send_set_schedule(&self) {
        let h = &self.heatlink;
        let payload = messages::set_schedule_command(
            self.ctl.schedule(),
            self.ctl.mode() == Mode::Heat,
            &h.tz,
            h.comfort_c,
            h.duty_pct,
        );
        self.publish(&self.topics.heatlink_commands, &payload);
    }

    fn send_pi_schedule(&self, now: DateTime<Utc>) {
        let payload = messages::pi_schedule_message(self.ctl.schedule(), now);
        self.publish(&self.topics.pi_schedule, &payload);
    }

    /// Re-run the control loop and publish whatever changed: demand
    /// immediately when it changes, `pi/state` when a viewer-visible field
    /// changes. Returns true if a demand was sent.
    pub fn refresh(&mut self, now: DateTime<Utc>) -> bool {
        if self.ctl.expire_override(now) {
            info!("Override expired at the schedule transition");
            self.persist();
        }
        let decision = self.ctl.evaluate(now);
        let mut sent = false;
        if !same_command(decision, self.last_sent) {
            match decision {
                Some(d) => {
                    if self.last_sent.is_none_or(|p| p.on != d.on) {
                        info!(
                            "Demand {} ({:?}, setpoint {:.1}°C, measured {:.1}°C)",
                            if d.on { "ON" } else { "off" },
                            d.source,
                            d.setpoint,
                            d.temperature
                        );
                    }
                    self.send_demand(d, now);
                    sent = true;
                }
                None => {
                    warn!("No good sensor reading recently; stopped sending demand");
                    self.last_sent = None;
                }
            }
        }
        // Track the latest decision so the heartbeat carries the current
        // temperature even when nothing else changed.
        self.last_sent = decision;
        let key = self.ctl.state(now).change_key();
        if self.last_state_key.as_ref() != Some(&key) {
            self.send_state(now);
        }
        sent
    }

    /// MQTT (re)connected: subscribe. Everything else is pushed once the
    /// SubAck arrives ([`Daemon::on_subscribed`]).
    pub fn on_connected(&mut self, now: DateTime<Utc>) {
        self.link.on_connack();
        self.try_subscribe(now);
    }

    /// The connection dropped: stop publishing until it is back.
    pub fn on_disconnected(&mut self) {
        if self.link.on_disconnect() {
            warn!("MQTT disconnected; dropping publishes until reconnected");
        }
    }

    /// A SubAck. Once subscribed, push everything the other side may have
    /// missed; a refused subscription is retried by [`Daemon::link_tick`].
    pub fn on_subscribed(&mut self, ok: bool, now: DateTime<Utc>) {
        if self.link.on_suback(ok, now) {
            info!("MQTT subscribed; pushing schedule, demand and state");
            self.push_all(now);
        } else if !ok {
            warn!("Broker refused a subscription; retrying");
        }
    }

    /// Every few seconds: re-send the subscription if no SubAck came back.
    pub fn link_tick(&mut self, now: DateTime<Utc>) {
        self.try_subscribe(now);
    }

    fn try_subscribe(&mut self, now: DateTime<Utc>) {
        if !self.link.should_subscribe(now) {
            return;
        }
        if let Err(e) = self.sink.subscribe_many(&self.topics.subscriptions()) {
            warn!("Subscribing failed (will retry): {e:#}");
        }
        self.link.subscribe_attempted(now);
    }

    fn push_all(&mut self, now: DateTime<Utc>) {
        self.send_set_schedule();
        self.send_pi_schedule(now);
        // Forget what was sent so refresh() re-sends demand and state.
        self.last_sent = None;
        self.last_state_key = None;
        self.refresh(now);
    }

    pub fn on_reading(&mut self, reading: &SensorReading, now: DateTime<Utc>) {
        if !self
            .ctl
            .record_reading(reading.temperature_c, reading.humidity_pct, now)
        {
            warn!(
                "Implausible reading ({:.1}°C, {:.1}%), not used for control",
                reading.temperature_c, reading.humidity_pct
            );
        }
        if self.publish_readings {
            match serde_json::to_string(reading) {
                Ok(payload) => self.publish(&self.topics.readings, &payload),
                Err(e) => warn!("Serialising reading failed: {e}"),
            }
            let _ = self.lines.send(socket::reading_line(reading));
        }
        self.refresh(now);
    }

    pub fn on_message(&mut self, topic: &str, payload: &str, now: DateTime<Utc>) {
        let msg = match self.topics.parse(topic, payload) {
            Ok(m) => m,
            Err(e) => {
                warn!("Ignoring message on {topic}: {e:#}");
                return;
            }
        };
        match msg {
            Inbound::Setpoint {
                temperature,
                user_id,
            } => {
                let mode_before = self.ctl.mode();
                match self.ctl.set_override(temperature, now) {
                    Ok(o) => {
                        info!(
                            "Override {:.1}°C until {} (from {topic}, user {})",
                            o.setpoint,
                            crate::control::ts::format(&o.until),
                            user_id.as_deref().unwrap_or("?")
                        );
                        self.persist();
                        if self.ctl.mode() != mode_before {
                            info!("Setpoint while off: mode back to heat");
                            self.send_set_schedule();
                        }
                    }
                    Err(e) => warn!("Rejected setpoint on {topic}: {e}"),
                }
            }
            Inbound::Mode { mode, user_id } => {
                let mode_before = self.ctl.mode();
                if self.ctl.set_mode(mode) {
                    info!("Mode {mode:?} (user {})", user_id.as_deref().unwrap_or("?"));
                    self.persist();
                }
                // The heatlink's fallback follows the mode (`enabled`).
                if self.ctl.mode() != mode_before {
                    self.send_set_schedule();
                }
            }
            Inbound::Schedule { schedule, user_id } => {
                if let Err(e) = schedule.save(&self.schedule_path) {
                    warn!("Saving new schedule failed (applying anyway): {e:#}");
                }
                if self.ctl.set_schedule(schedule, now) {
                    if let Some(o) = self.ctl.active_override(now) {
                        info!(
                            "Override now ends at {} (the new schedule's next transition)",
                            crate::control::ts::format(&o.until)
                        );
                    }
                    self.persist();
                }
                info!(
                    "New schedule applied (user {})",
                    user_id.as_deref().unwrap_or("?")
                );
                self.send_set_schedule();
                self.send_pi_schedule(now);
            }
            Inbound::HeatlinkStatus(status) => self.ctl.on_heatlink_status(status, now),
        }
        self.refresh(now);
    }

    /// Every `demand_interval_s`: keep the heatlink's demand fresh.
    pub fn demand_tick(&mut self, now: DateTime<Utc>) {
        if !self.refresh(now) {
            if let Some(d) = self.last_sent {
                self.send_demand(d, now);
            }
        }
    }

    /// Every `state_interval_s`: publish `pi/state` regardless of change.
    pub fn state_tick(&mut self, now: DateTime<Utc>) {
        self.last_state_key = None;
        self.refresh(now);
    }

    /// Every `schedule_push_interval_s`: re-send `set_schedule`.
    pub fn schedule_push_tick(&mut self) {
        self.send_set_schedule();
    }

    /// Hourly: re-publish `pi/schedule`.
    pub fn pi_schedule_tick(&mut self, now: DateTime<Utc>) {
        self.send_pi_schedule(now);
    }
}

/// Demand is re-sent immediately only when what the heatlink acts on (or
/// echoes) changes — not for every temperature wobble, which the 30 s
/// heartbeat carries anyway.
fn same_command(a: Option<Demand>, b: Option<Demand>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.on == b.on && a.source == b.source && a.setpoint == b.setpoint,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::HeatlinkConfig;
    use crate::control::{ControlParams, Mode, Persisted};
    use crate::mqtt::tests::CaptureSink;
    use crate::schedule::{Schedule, default_schedule};
    use serde_json::{Value, json};

    const CMD: &str = "nakostat/nakostat-heatlink/commands";
    const STATE: &str = "nakostat/sandbox/pi/state";
    const PI_SCHED: &str = "nakostat/sandbox/pi/schedule";
    const READINGS: &str = "nakostat/sandbox/pi/readings";

    struct Rig {
        d: Daemon<Utc>,
        sink: Arc<CaptureSink>,
        lines: broadcast::Receiver<String>,
        dir: tempfile::TempDir,
    }

    impl Rig {
        /// A daemon whose MQTT link is up and subscribed, with the connect
        /// pushes (at 00:00) already cleared away.
        fn new() -> Self {
            Self::with(default_schedule(), Persisted::default())
        }

        fn with(schedule: Schedule, persisted: Persisted) -> Self {
            let mut r = Self::offline(schedule, persisted);
            r.d.on_connected(at(0, 0));
            r.d.on_subscribed(true, at(0, 0));
            r.sink.take();
            r.sink.subscribed.lock().unwrap().clear();
            r.lines();
            r
        }

        /// A daemon that has not connected yet.
        fn offline(schedule: Schedule, persisted: Persisted) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let sink = Arc::new(CaptureSink::default());
            let (tx, rx) = broadcast::channel(64);
            let ctl = Controller::new(ControlParams::default(), Utc, schedule, persisted);
            let d = Daemon::new(
                ctl,
                sink.clone(),
                Topics::new("sandbox", READINGS, "nakostat-heatlink"),
                HeatlinkConfig::default(),
                dir.path().join("schedule.json"),
                dir.path().join("control.json"),
                tx,
            );
            Self {
                d,
                sink,
                lines: rx,
                dir,
            }
        }

        fn on(&self, topic: &str) -> Vec<Value> {
            self.sink
                .published()
                .into_iter()
                .filter(|(t, _)| t == topic)
                .map(|(_, p)| serde_json::from_str(&p).unwrap())
                .collect()
        }

        fn commands(&self, name: &str) -> Vec<Value> {
            self.on(CMD)
                .into_iter()
                .filter(|v| v["command"] == name)
                .collect()
        }

        fn lines(&mut self) -> Vec<String> {
            let mut out = vec![];
            while let Ok(l) = self.lines.try_recv() {
                out.push(l);
            }
            out
        }
    }

    /// Monday 19 Oct 2026, hh:mm UTC. Default schedule: 16 °C 09:00–17:00.
    fn at(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 19, h, m, 0).unwrap()
    }

    fn reading(t: f32, now: DateTime<Utc>) -> SensorReading {
        SensorReading {
            temperature_c: t,
            humidity_pct: 45.0,
            eco2_ppm: 600,
            tvoc_ppb: 100,
            warming_up: false,
            timestamp: now,
        }
    }

    fn offline_rig() -> Rig {
        Rig::offline(default_schedule(), Persisted::default())
    }

    fn subscribe_calls(r: &Rig) -> usize {
        r.sink.subscribed.lock().unwrap().len()
    }

    #[test]
    fn on_connected_subscribes_then_pushes_everything_after_suback() {
        let mut r = offline_rig();
        r.d.on_connected(at(10, 0));
        assert_eq!(
            *r.sink.subscribed.lock().unwrap(),
            vec![vec![
                "nakostat/sandbox/api/setpoint",
                "nakostat/sandbox/pish/setpoint",
                "nakostat/sandbox/api/mode",
                "nakostat/sandbox/api/schedule",
                "nakostat/nakostat-heatlink/status",
            ]],
            "one SUBSCRIBE for every topic"
        );
        assert!(
            r.sink.published().is_empty(),
            "nothing pushed before the SubAck"
        );
        r.d.on_subscribed(true, at(10, 0));
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 1);
        assert_eq!(ss[0]["enabled"], true);
        assert_eq!(ss[0]["tz"], "GMT0BST,M3.5.0/1,M10.5.0");
        assert_eq!(ss[0]["comfort_c"], 18.0);
        assert_eq!(ss[0]["duty_pct"], 67);
        assert_eq!(ss[0]["days"].as_array().unwrap().len(), 7);
        assert_eq!(r.on(PI_SCHED).len(), 1);
        assert!(!r.on(STATE).is_empty());
        // No reading yet → stale → no demand.
        assert!(r.commands("demand").is_empty());
    }

    #[test]
    fn reading_sends_demand_immediately() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        let d = r.commands("demand");
        assert_eq!(d.len(), 1);
        assert_eq!(
            d[0],
            json!({"command":"demand","on":true,"source":"schedule","setpoint":16.0,"temperature":14.0,"ttl_s":300,"ts":1792404000})
        );
        let s = r.on(STATE);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0]["demand"], true);
    }

    #[test]
    fn unchanged_demand_is_not_resent_on_reading_but_is_on_tick() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        assert_eq!(r.commands("demand").len(), 1);
        r.d.demand_tick(at(10, 0));
        assert_eq!(r.commands("demand").len(), 2);
    }

    #[test]
    fn changed_temperature_alone_does_not_resend_demand() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.on_reading(&reading(14.5, at(10, 1)), at(10, 1));
        assert_eq!(r.commands("demand").len(), 1);
        // The heartbeat carries the latest temperature.
        r.d.demand_tick(at(10, 1));
        assert_eq!(r.commands("demand")[1]["temperature"], 14.5);
    }

    #[test]
    fn reconnect_resends_demand_and_state() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.sink.take();
        r.d.on_disconnected();
        r.d.on_connected(at(10, 0));
        assert!(r.commands("demand").is_empty(), "not before the SubAck");
        r.d.on_subscribed(true, at(10, 0));
        assert_eq!(r.commands("demand").len(), 1);
        assert_eq!(r.on(STATE).len(), 1);
        assert_eq!(r.commands("set_schedule").len(), 1);
    }

    #[test]
    fn nothing_is_published_while_disconnected() {
        let mut r = Rig::new();
        r.d.set_publish_readings(true);
        r.d.on_disconnected();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.demand_tick(at(10, 0));
        r.d.state_tick(at(10, 0));
        r.d.schedule_push_tick();
        r.d.pi_schedule_tick(at(10, 0));
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 1));
        assert!(r.sink.published().is_empty(), "{:?}", r.sink.published());
        // Pish still gets readings and state over the local socket.
        let lines = r.lines();
        assert!(lines.iter().any(|l| l.starts_with(r#"{"temperature_c""#)));
        assert!(lines.iter().any(|l| l.starts_with(r#"{"type":"state""#)));
        // On reconnect the current state goes out, including mode off.
        r.d.on_connected(at(10, 2));
        r.d.on_subscribed(true, at(10, 2));
        assert_eq!(r.commands("set_schedule")[0]["enabled"], false);
        assert_eq!(r.commands("demand")[0]["source"], "off");
        assert_eq!(r.on(STATE)[0]["mode"], "off");
    }

    #[test]
    fn nothing_is_published_before_first_connect() {
        let mut r = offline_rig();
        r.d.set_publish_readings(true);
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.demand_tick(at(10, 0));
        assert!(r.sink.published().is_empty());
    }

    #[test]
    fn periodic_publishes_continue_while_subscribing() {
        let mut r = offline_rig();
        r.d.on_connected(at(10, 0));
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        assert_eq!(r.commands("demand").len(), 1);
    }

    #[test]
    fn missing_suback_is_retried_on_link_tick() {
        let mut r = offline_rig();
        r.d.on_connected(at(10, 0));
        r.d.link_tick(at(10, 0) + chrono::Duration::seconds(5));
        assert_eq!(subscribe_calls(&r), 1);
        r.d.link_tick(at(10, 0) + chrono::Duration::seconds(10));
        assert_eq!(subscribe_calls(&r), 2);
        r.d.on_subscribed(true, at(10, 0) + chrono::Duration::seconds(11));
        r.d.link_tick(at(10, 1));
        assert_eq!(subscribe_calls(&r), 2, "no retries once subscribed");
        assert_eq!(r.commands("set_schedule").len(), 1);
    }

    #[test]
    fn refused_subscription_is_retried_and_pushes_nothing() {
        let mut r = offline_rig();
        r.d.on_connected(at(10, 0));
        r.d.on_subscribed(false, at(10, 0));
        assert!(r.commands("set_schedule").is_empty());
        r.d.link_tick(at(10, 0) + chrono::Duration::seconds(10));
        assert_eq!(subscribe_calls(&r), 2);
        r.d.on_subscribed(true, at(10, 0) + chrono::Duration::seconds(11));
        assert_eq!(r.commands("set_schedule").len(), 1);
        // A late duplicate SubAck pushes nothing more.
        r.d.on_subscribed(true, at(10, 0) + chrono::Duration::seconds(12));
        assert_eq!(r.commands("set_schedule").len(), 1);
    }

    #[test]
    fn failed_subscribe_enqueue_is_retried() {
        struct FullSink(std::sync::Mutex<u32>);
        impl MqttSink for FullSink {
            fn publish(&self, _: &str, _: &str) -> anyhow::Result<()> {
                Ok(())
            }
            fn subscribe_many(&self, _: &[&str]) -> anyhow::Result<()> {
                *self.0.lock().unwrap() += 1;
                Err(anyhow::anyhow!("channel full"))
            }
        }
        let sink = Arc::new(FullSink(std::sync::Mutex::new(0)));
        let mut r = offline_rig();
        r.d.sink = sink.clone();
        r.d.on_connected(at(10, 0));
        r.d.link_tick(at(10, 0) + chrono::Duration::seconds(10));
        r.d.link_tick(at(10, 0) + chrono::Duration::seconds(20));
        assert_eq!(*sink.0.lock().unwrap(), 3);
    }

    #[test]
    fn mode_change_resends_set_schedule_with_enabled() {
        let mut r = Rig::new();
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 0));
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 1);
        assert_eq!(ss[0]["enabled"], false);
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 1));
        assert_eq!(r.commands("set_schedule").len(), 1, "no change, no resend");
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"heat"}"#, at(10, 2));
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 2);
        assert_eq!(ss[1]["enabled"], true);
    }

    #[test]
    fn periodic_set_schedule_reflects_mode() {
        let persisted = Persisted {
            mode: Mode::Off,
            override_: None,
        };
        let mut r = Rig::with(default_schedule(), persisted);
        r.d.schedule_push_tick();
        assert_eq!(r.commands("set_schedule")[0]["enabled"], false);
    }

    #[test]
    fn setpoint_while_off_switches_to_heat_and_applies() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(17.0, at(10, 0)), at(10, 0));
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 0));
        r.sink.take();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":21.0,"userId":"alexa"}"#,
            at(10, 1),
        );
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 1);
        assert_eq!(ss[0]["enabled"], true);
        let d = r.commands("demand");
        assert_eq!(d[0]["source"], "override");
        assert_eq!(d[0]["setpoint"], 21.0);
        assert_eq!(d[0]["on"], true);
        assert_eq!(r.on(STATE)[0]["mode"], "heat");
        let saved = Persisted::load(&r.dir.path().join("control.json"));
        assert_eq!(saved.mode, Mode::Heat);
        assert_eq!(saved.override_.unwrap().setpoint, 21.0);
    }

    #[test]
    fn setpoint_while_heating_does_not_resend_set_schedule() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":21.0}"#,
            at(10, 0),
        );
        assert!(r.commands("set_schedule").is_empty());
    }

    #[test]
    fn new_schedule_moves_override_expiry_and_persists() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":21.0}"#,
            at(10, 0),
        );
        r.d.on_message(
            "nakostat/sandbox/api/schedule",
            r#"{"schedule":{"Mon":[{"at":"06:00","targetC":19.0},{"at":"12:00","targetC":17.0}]}}"#,
            at(11, 0),
        );
        let saved = Persisted::load(&r.dir.path().join("control.json"));
        assert_eq!(saved.override_.unwrap().until, at(12, 0));
        assert_eq!(
            r.on(STATE).last().unwrap()["override"],
            json!({"setpoint":21.0,"until":"2026-10-19T12:00:00Z"})
        );
    }

    #[test]
    fn demand_refused_on_mock_build_unless_allowed() {
        let mut r = Rig::new();
        r.d.set_demand_allowed(false);
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.demand_tick(at(10, 0));
        r.d.demand_tick(at(10, 1));
        assert!(r.commands("demand").is_empty());
        // State still goes out, so the UI shows what the loop decided.
        assert_eq!(r.on(STATE).last().unwrap()["demand"], true);
        r.d.set_demand_allowed(true);
        r.d.demand_tick(at(10, 2));
        assert_eq!(r.commands("demand").len(), 1);
    }

    #[test]
    fn demand_tick_without_reading_sends_nothing() {
        let mut r = Rig::new();
        r.d.demand_tick(at(10, 0));
        assert!(r.commands("demand").is_empty());
    }

    #[test]
    fn stale_sensor_stops_demand() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.sink.take();
        r.d.demand_tick(at(10, 10));
        assert!(r.commands("demand").is_empty());
        let s = r.on(STATE);
        assert_eq!(s.len(), 1, "state changed (demand stopped)");
        assert_eq!(s[0]["demand"], false);
        assert_eq!(s[0]["demand_source"], Value::Null);
        r.d.demand_tick(at(10, 11));
        assert!(r.commands("demand").is_empty());
    }

    #[test]
    fn setpoint_message_creates_override_and_persists() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(17.0, at(10, 0)), at(10, 0));
        r.sink.take();
        r.d.on_message(
            "nakostat/sandbox/pish/setpoint",
            r#"{"temperature":21.0,"timestamp":"2026-10-19T10:01:00Z","userId":"nakostat-pish-prod"}"#,
            at(10, 1),
        );
        let d = r.commands("demand");
        assert_eq!(d.len(), 1);
        assert_eq!(d[0]["on"], true);
        assert_eq!(d[0]["source"], "override");
        assert_eq!(d[0]["setpoint"], 21.0);
        let s = r.on(STATE);
        assert_eq!(
            s[0]["override"],
            json!({"setpoint":21.0,"until":"2026-10-19T17:00:00Z"})
        );
        let saved = Persisted::load(&r.dir.path().join("control.json"));
        assert_eq!(saved.override_.unwrap().setpoint, 21.0);
    }

    #[test]
    fn api_setpoint_is_also_an_override() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":19.5}"#,
            at(10, 0),
        );
        assert_eq!(r.on(STATE).last().unwrap()["setpoint"], 19.5);
    }

    #[test]
    fn rejected_setpoint_changes_nothing() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":99.0}"#,
            at(10, 0),
        );
        assert!(!r.dir.path().join("control.json").exists());
        assert_eq!(r.on(STATE).last().unwrap()["override"], Value::Null);
    }

    #[test]
    fn override_expires_at_transition_and_is_persisted() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":21.0}"#,
            at(10, 0),
        );
        r.d.on_reading(&reading(19.0, at(17, 0)), at(17, 0));
        let s = r.on(STATE);
        assert_eq!(s.last().unwrap()["override"], Value::Null);
        assert_eq!(s.last().unwrap()["setpoint"], 20.0);
        let saved = Persisted::load(&r.dir.path().join("control.json"));
        assert_eq!(saved.override_, None);
    }

    #[test]
    fn mode_off_sends_off_demand_and_persists() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.sink.take();
        r.d.on_message(
            "nakostat/sandbox/api/mode",
            r#"{"mode":"off","timestamp":"2026-10-19T10:00:30Z","userId":"alexa"}"#,
            at(10, 0),
        );
        let d = r.commands("demand");
        assert_eq!(d[0]["on"], false);
        assert_eq!(d[0]["source"], "off");
        assert_eq!(d[0]["setpoint"], 7.0);
        assert_eq!(r.on(STATE)[0]["mode"], "off");
        assert_eq!(
            Persisted::load(&r.dir.path().join("control.json")).mode,
            Mode::Off
        );
        // Repeating the same mode changes nothing.
        r.sink.take();
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 0));
        assert!(r.sink.published().is_empty());
    }

    #[test]
    fn mode_and_override_survive_restart() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/setpoint",
            r#"{"temperature":22.0}"#,
            at(10, 0),
        );
        let persisted = Persisted::load(&r.dir.path().join("control.json"));
        let mut r2 = Rig::with(default_schedule(), persisted);
        r2.d.on_reading(&reading(18.0, at(11, 0)), at(11, 0));
        assert_eq!(r2.commands("demand")[0]["setpoint"], 22.0);
        assert_eq!(r2.commands("demand")[0]["source"], "override");
    }

    #[test]
    fn schedule_message_is_saved_applied_and_pushed() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(17.0, at(10, 0)), at(10, 0));
        r.sink.take();
        r.d.on_message(
            "nakostat/sandbox/api/schedule",
            r#"{"schedule":{"Mon":[{"at":"06:00","targetC":21.0}]},"timestamp":"2026-10-19T10:00:00Z","userId":"web"}"#,
            at(10, 1),
        );
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 1);
        assert_eq!(ss[0]["days"][0], json!([[360, 21.0]]));
        assert_eq!(
            r.on(PI_SCHED)[0]["schedule"]["Mon"],
            json!([{"at":"06:00","targetC":21.0}])
        );
        let d = r.commands("demand");
        assert_eq!(d[0]["setpoint"], 21.0);
        assert_eq!(d[0]["on"], true);
        let saved = crate::schedule::load_or_default(&r.dir.path().join("schedule.json"));
        assert_eq!(saved.entries(crate::schedule::DayOfWeek::Mon).len(), 1);
    }

    #[test]
    fn invalid_schedule_message_is_ignored() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/sandbox/api/schedule",
            r#"{"schedule":{"Mon":[{"at":"26:00","targetC":21.0}]}}"#,
            at(10, 0),
        );
        assert!(r.sink.published().is_empty());
        assert!(!r.dir.path().join("schedule.json").exists());
    }

    #[test]
    fn schedule_save_failure_still_applies() {
        let mut r = Rig::new();
        // Make the schedule path unwritable: its parent is a file.
        let blocker = r.dir.path().join("blocker");
        std::fs::write(&blocker, "x").unwrap();
        r.d.schedule_path = blocker.join("schedule.json");
        r.d.state_path = blocker.join("control.json");
        r.d.on_message(
            "nakostat/sandbox/api/schedule",
            r#"{"schedule":{"Mon":[{"at":"06:00","targetC":21.0}]}}"#,
            at(10, 0),
        );
        assert_eq!(r.commands("set_schedule").len(), 1);
        // A failing control-state save is logged, not fatal.
        r.d.on_message("nakostat/sandbox/api/mode", r#"{"mode":"off"}"#, at(10, 0));
        assert_eq!(r.on(STATE).last().unwrap()["mode"], "off");
    }

    #[test]
    fn heatlink_status_appears_in_state() {
        let mut r = Rig::new();
        r.d.on_message(
            "nakostat/nakostat-heatlink/status",
            r#"{"mode":"fallback","relay":true,"switch":"auto","source":"fallback","demand_age_s":400,"schedule_known":true,"time_valid":true,"rssi":-61,"uptime_s":3600,"reason":"change"}"#,
            at(10, 0),
        );
        let s = r.on(STATE);
        assert_eq!(
            s.last().unwrap()["heatlink"],
            json!({"mode":"fallback","relay":true,"switch":"auto","seen":"2026-10-19T10:00:00Z"})
        );
        // A heartbeat with the same content is not a change.
        r.sink.take();
        r.d.on_message(
            "nakostat/nakostat-heatlink/status",
            r#"{"mode":"fallback","relay":true,"switch":"auto","reason":"heartbeat"}"#,
            at(10, 1),
        );
        assert!(r.on(STATE).is_empty());
    }

    #[test]
    fn malformed_message_is_ignored() {
        let mut r = Rig::new();
        r.d.on_message("nakostat/sandbox/api/mode", "{", at(10, 0));
        r.d.on_message("some/other/topic", "{}", at(10, 0));
        assert!(r.sink.published().is_empty());
    }

    #[test]
    fn state_tick_always_publishes() {
        let mut r = Rig::new();
        r.d.state_tick(at(10, 0));
        r.d.state_tick(at(10, 1));
        assert_eq!(r.on(STATE).len(), 2, "once per tick, no duplicates");
    }

    #[test]
    fn schedule_ticks_publish() {
        let mut r = Rig::new();
        r.d.schedule_push_tick();
        r.d.pi_schedule_tick(at(11, 0));
        assert_eq!(r.commands("set_schedule").len(), 1);
        assert_eq!(r.on(PI_SCHED)[0]["timestamp"], "2026-10-19T11:00:00Z");
    }

    #[test]
    fn readings_published_only_after_warmup() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(19.0, at(10, 0)), at(10, 0));
        assert!(r.on(READINGS).is_empty());
        assert!(
            r.lines()
                .iter()
                .all(|l| l.starts_with(r#"{"type":"state""#))
        );
        r.d.set_publish_readings(true);
        r.d.on_reading(&reading(19.0, at(10, 1)), at(10, 1));
        let rd = r.on(READINGS);
        assert_eq!(rd.len(), 1);
        assert_eq!(rd[0]["temperature_c"], 19.0);
        let lines = r.lines();
        assert!(
            lines
                .iter()
                .any(|l| l.starts_with(r#"{"temperature_c":19.0"#)),
            "{lines:?}"
        );
    }

    #[test]
    fn socket_gets_state_lines() {
        let mut r = Rig::new();
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        let lines = r.lines();
        let state: Vec<Value> = lines
            .iter()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .filter(|v| v["type"] == "state")
            .collect();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0]["demand"], true);
        assert_eq!(state[0]["demand_source"], "schedule");
    }

    #[test]
    fn implausible_reading_is_published_but_not_used() {
        let mut r = Rig::new();
        r.d.set_publish_readings(true);
        r.d.on_reading(&reading(85.0, at(10, 0)), at(10, 0));
        assert_eq!(r.on(READINGS).len(), 1);
        assert!(r.commands("demand").is_empty());
    }

    #[test]
    fn publish_errors_are_not_fatal() {
        struct FailSink;
        impl MqttSink for FailSink {
            fn publish(&self, _: &str, _: &str) -> anyhow::Result<()> {
                Err(anyhow::anyhow!("full"))
            }
            fn subscribe_many(&self, _: &[&str]) -> anyhow::Result<()> {
                Err(anyhow::anyhow!("full"))
            }
        }
        let mut r = Rig::new();
        r.d.sink = Arc::new(FailSink);
        r.d.on_connected(at(10, 0));
        r.d.on_subscribed(true, at(10, 0));
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.demand_tick(at(10, 1));
    }
}
