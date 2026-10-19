//! The daemon's event handling: glues the pure [`Controller`] to MQTT, the
//! Unix socket and the files on disk. Synchronous and clock-injected, so the
//! whole flow (messages in → commands out) is unit-tested; `main.rs` only owns
//! the timers and the event loop.

use chrono::{DateTime, TimeZone, Utc};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::config::HeatlinkConfig;
use crate::control::{Controller, Demand, PiState};
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
        }
    }

    pub fn set_publish_readings(&mut self, on: bool) {
        self.publish_readings = on;
    }

    fn publish(&self, topic: &str, payload: &str) {
        if let Err(e) = self.sink.publish(topic, payload) {
            warn!("MQTT publish to {topic} failed: {e:#}");
        }
    }

    fn persist(&self) {
        if let Err(e) = self.ctl.persisted().save(&self.state_path) {
            warn!("Saving control state failed: {e:#}");
        }
    }

    fn send_demand(&mut self, d: Demand) {
        let payload = messages::demand_command(&d, self.heatlink.demand_ttl_s);
        self.publish(&self.topics.heatlink_commands, &payload);
        self.last_sent = Some(d);
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
        let payload =
            messages::set_schedule_command(self.ctl.schedule(), &h.tz, h.comfort_c, h.duty_pct);
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
                    self.send_demand(d);
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

    /// MQTT (re)connected: resubscribe, then push everything the other side
    /// may have missed.
    pub fn on_connected(&mut self, now: DateTime<Utc>) {
        for topic in self.topics.subscriptions() {
            if let Err(e) = self.sink.subscribe(topic) {
                warn!("Subscribing to {topic} failed: {e:#}");
            }
        }
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
            } => match self.ctl.set_override(temperature, now) {
                Ok(o) => {
                    info!(
                        "Override {:.1}°C until {} (from {topic}, user {})",
                        o.setpoint,
                        crate::control::ts::format(&o.until),
                        user_id.as_deref().unwrap_or("?")
                    );
                    self.persist();
                }
                Err(e) => warn!("Rejected setpoint on {topic}: {e}"),
            },
            Inbound::Mode { mode, user_id } => {
                if self.ctl.set_mode(mode) {
                    info!("Mode {mode:?} (user {})", user_id.as_deref().unwrap_or("?"));
                    self.persist();
                }
            }
            Inbound::Schedule { schedule, user_id } => {
                if let Err(e) = schedule.save(&self.schedule_path) {
                    warn!("Saving new schedule failed (applying anyway): {e:#}");
                }
                self.ctl.set_schedule(schedule);
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
                self.send_demand(d);
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
        fn new() -> Self {
            Self::with(default_schedule(), Persisted::default())
        }

        fn with(schedule: Schedule, persisted: Persisted) -> Self {
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

    #[test]
    fn on_connected_subscribes_and_pushes_everything() {
        let mut r = Rig::new();
        r.d.on_connected(at(10, 0));
        assert_eq!(
            *r.sink.subscribed.lock().unwrap(),
            vec![
                "nakostat/sandbox/api/setpoint",
                "nakostat/sandbox/pish/setpoint",
                "nakostat/sandbox/api/mode",
                "nakostat/sandbox/api/schedule",
                "nakostat/nakostat-heatlink/status",
            ]
        );
        let ss = r.commands("set_schedule");
        assert_eq!(ss.len(), 1);
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
            json!({"command":"demand","on":true,"source":"schedule","setpoint":16.0,"temperature":14.0,"ttl_s":300})
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
        r.d.on_connected(at(10, 0));
        assert_eq!(r.commands("demand").len(), 1);
        assert_eq!(r.on(STATE).len(), 1);
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
            fn subscribe(&self, _: &str) -> anyhow::Result<()> {
                Err(anyhow::anyhow!("full"))
            }
        }
        let mut r = Rig::new();
        r.d.sink = Arc::new(FailSink);
        r.d.on_connected(at(10, 0));
        r.d.on_reading(&reading(14.0, at(10, 0)), at(10, 0));
        r.d.demand_tick(at(10, 1));
    }
}
