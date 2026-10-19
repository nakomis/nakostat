//! Heating control logic (STAT-51, STAT-47): effective setpoint, overrides,
//! hysteresis, the short-cycle guard and stale-sensor detection.
//!
//! Pure and clock-injected: every method that depends on time takes `now`, and
//! the local time zone used to evaluate the schedule is a type parameter
//! (`chrono::Local` on the Pi, a fixed offset in tests). No I/O except
//! [`Persisted::load`] / [`Persisted::save`].
//!
//! Rules (spec *Control logic (daemon)*):
//! - Effective setpoint: mode `off` → the frost floor; else the active override
//!   (which lasts until the next schedule transition, Nest-style); else the
//!   schedule. An empty schedule falls back to the frost floor. A setpoint
//!   received in mode `off` switches back to `heat` and applies; replacing the
//!   schedule moves an active override's end to the new next transition.
//! - Hysteresis: demand turns on when `T < SP − 0.3`, off when `T ≥ SP + 0.2`.
//! - Short-cycle guard: once demand changes it holds for 3 minutes, unless the
//!   setpoint moves by 1 °C or more from the one in force at the last change.
//! - Stale sensor (no good reading for 5 minutes): no demand at all, so the
//!   heatlink falls back to its own schedule.

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::schedule::{MAX_TARGET_C, MIN_TARGET_C, Schedule};

/// Plausible range for a room temperature reading; anything outside is a
/// sensor fault, not a good reading.
const MIN_PLAUSIBLE_C: f32 = -20.0;
const MAX_PLAUSIBLE_C: f32 = 50.0;

/// How long an override lasts when the schedule is empty (so there is no next
/// transition to end it).
const OVERRIDE_WITHOUT_SCHEDULE: Duration = Duration::hours(24);

/// Serialise timestamps as `2026-10-19T07:00:00Z` (whole seconds, `Z`).
pub mod ts {
    use chrono::{DateTime, SecondsFormat, Utc};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn format(t: &DateTime<Utc>) -> String {
        t.to_rfc3339_opts(SecondsFormat::Secs, true)
    }

    pub fn serialize<S: Serializer>(t: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(&format(t))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DateTime<Utc>, D::Error> {
        let s = String::deserialize(d)?;
        DateTime::parse_from_rfc3339(&s)
            .map(|t| t.with_timezone(&Utc))
            .map_err(serde::de::Error::custom)
    }
}

/// The user-selected heating mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Heat,
    Off,
}

/// Why demand is what it is; echoed back by the heatlink as `source`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Schedule,
    Override,
    Frost,
    Off,
}

/// A manual setpoint that holds until `until` (the next schedule transition).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Override {
    pub setpoint: f32,
    #[serde(with = "ts")]
    pub until: DateTime<Utc>,
}

/// Mode and override, persisted next to the schedule so they survive a restart.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Persisted {
    #[serde(default)]
    pub mode: Mode,
    #[serde(rename = "override", default)]
    pub override_: Option<Override>,
}

impl Persisted {
    /// Load from `path`. A missing or corrupt file gives the default (heat, no
    /// override) — the heating must always come up in a usable state.
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::error!(
                    "Control state {} is corrupt ({e}); using defaults",
                    path.display()
                );
                Self::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => {
                tracing::error!(
                    "Reading control state {} failed: {e}; using defaults",
                    path.display()
                );
                Self::default()
            }
        }
    }

    /// Write atomically (temp file + rename), creating the directory if needed.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("creating directory {}", dir.display()))?;
        }
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(self).expect("control state serialises");
        std::fs::write(&tmp, text).with_context(|| format!("writing {}", tmp.display()))?;
        std::fs::rename(&tmp, path).with_context(|| format!("renaming to {}", path.display()))
    }
}

/// Tuning for the control loop. Defaults are the spec's values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ControlParams {
    /// Setpoint in mode `off` (and when the schedule is empty).
    pub frost_c: f32,
    /// Demand turns on below `SP − hysteresis_below_c`.
    pub hysteresis_below_c: f32,
    /// Demand turns off at or above `SP + hysteresis_above_c`.
    pub hysteresis_above_c: f32,
    /// Minimum time between demand changes.
    pub min_cycle: Duration,
    /// A setpoint move of at least this much bypasses the short-cycle guard.
    pub setpoint_jump_c: f32,
    /// No good reading for this long → stop demanding.
    pub stale_after: Duration,
}

impl Default for ControlParams {
    fn default() -> Self {
        Self {
            frost_c: 7.0,
            hysteresis_below_c: 0.3,
            hysteresis_above_c: 0.2,
            min_cycle: Duration::minutes(3),
            setpoint_jump_c: 1.0,
            stale_after: Duration::minutes(5),
        }
    }
}

/// What the daemon tells the heatlink.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Demand {
    pub on: bool,
    pub source: Source,
    pub setpoint: f32,
    pub temperature: f32,
}

/// The fields of a heatlink status the daemon cares about.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct HeatlinkStatus {
    pub mode: String,
    pub relay: bool,
    pub switch: String,
}

/// The heatlink as last seen, for `pi/state`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeatlinkView {
    pub mode: String,
    pub relay: bool,
    pub switch: String,
    #[serde(with = "ts")]
    pub seen: DateTime<Utc>,
}

/// The `pi/state` object (spec *Daemon state*).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PiState {
    #[serde(with = "ts")]
    pub timestamp: DateTime<Utc>,
    pub temperature: Option<f32>,
    pub humidity: Option<f32>,
    pub mode: Mode,
    pub setpoint: f32,
    pub scheduled_setpoint: Option<f32>,
    #[serde(rename = "override")]
    pub override_: Option<Override>,
    pub demand: bool,
    /// `None` while the sensor is stale (no demand is being sent).
    pub demand_source: Option<Source>,
    pub heatlink: Option<HeatlinkView>,
}

impl PiState {
    /// The state with its ever-changing fields (timestamp, readings, heatlink
    /// last-seen) blanked, so two keys compare equal unless something a viewer
    /// cares about has changed.
    pub fn change_key(&self) -> PiState {
        let mut k = self.clone();
        k.timestamp = DateTime::<Utc>::UNIX_EPOCH;
        k.temperature = None;
        k.humidity = None;
        if let Some(h) = k.heatlink.as_mut() {
            h.seen = DateTime::<Utc>::UNIX_EPOCH;
        }
        k
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Reading {
    temperature: f32,
    humidity: f32,
    at: DateTime<Utc>,
}

/// Where the effective setpoint comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Basis {
    Schedule,
    Override,
    /// Mode is heat but the schedule is empty.
    NoSchedule,
    ModeOff,
}

/// The heating brain. One instance lives for the life of the daemon.
pub struct Controller<Tz: TimeZone> {
    params: ControlParams,
    tz: Tz,
    schedule: Schedule,
    mode: Mode,
    override_: Option<Override>,
    reading: Option<Reading>,
    demand_on: bool,
    /// When demand last changed and the setpoint in force at the time.
    last_change: Option<(DateTime<Utc>, f32)>,
    /// Result of the most recent [`Controller::evaluate`].
    last_demand: Option<Demand>,
    heatlink: Option<HeatlinkView>,
}

impl<Tz: TimeZone> Controller<Tz> {
    pub fn new(params: ControlParams, tz: Tz, schedule: Schedule, persisted: Persisted) -> Self {
        Self {
            params,
            tz,
            schedule,
            mode: persisted.mode,
            override_: persisted.override_,
            reading: None,
            demand_on: false,
            last_change: None,
            last_demand: None,
            heatlink: None,
        }
    }

    pub fn schedule(&self) -> &Schedule {
        &self.schedule
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn persisted(&self) -> Persisted {
        Persisted {
            mode: self.mode,
            override_: self.override_,
        }
    }

    /// Record a sensor reading. Returns false (and ignores it) if the values
    /// are not plausible, so a faulty sensor eventually goes stale.
    pub fn record_reading(&mut self, temperature: f32, humidity: f32, at: DateTime<Utc>) -> bool {
        let good = temperature.is_finite()
            && (MIN_PLAUSIBLE_C..=MAX_PLAUSIBLE_C).contains(&temperature)
            && humidity.is_finite();
        if good {
            self.reading = Some(Reading {
                temperature,
                humidity,
                at,
            });
        }
        good
    }

    /// True if there has been no good reading within `stale_after`.
    pub fn is_stale(&self, now: DateTime<Utc>) -> bool {
        match self.reading {
            None => true,
            Some(r) => now - r.at > self.params.stale_after,
        }
    }

    /// The schedule's setpoint at `now` (local time), ignoring mode and override.
    pub fn scheduled_setpoint(&self, now: DateTime<Utc>) -> Option<f32> {
        self.schedule.current_setpoint(now.with_timezone(&self.tz))
    }

    /// The override, if one is set and has not yet expired.
    pub fn active_override(&self, now: DateTime<Utc>) -> Option<Override> {
        self.override_.filter(|o| now < o.until)
    }

    /// When an override set at `now` ends: the next schedule transition, or a
    /// day later if the schedule is empty.
    fn override_until(&self, now: DateTime<Utc>) -> DateTime<Utc> {
        self.schedule
            .next_transition_after(&now.with_timezone(&self.tz))
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or(now + OVERRIDE_WITHOUT_SCHEDULE)
    }

    /// Set a manual setpoint (Pish, web, Alexa): an override until the next
    /// schedule transition. Rejects non-finite or out-of-range values.
    ///
    /// A setpoint received in mode `off` switches the mode back to `heat`:
    /// "set the heating to 21" means "heat to 21", not "remember 21 for later".
    /// Callers detect the switch by comparing [`Controller::mode`] before and
    /// after.
    pub fn set_override(&mut self, setpoint: f32, now: DateTime<Utc>) -> Result<Override, String> {
        if !setpoint.is_finite() || !(MIN_TARGET_C..=MAX_TARGET_C).contains(&setpoint) {
            return Err(format!(
                "setpoint {setpoint} outside {MIN_TARGET_C}–{MAX_TARGET_C} °C"
            ));
        }
        let o = Override {
            setpoint,
            until: self.override_until(now),
        };
        self.mode = Mode::Heat;
        self.override_ = Some(o);
        Ok(o)
    }

    /// Change mode. Switching off also cancels any override. Returns true if
    /// anything changed.
    pub fn set_mode(&mut self, mode: Mode) -> bool {
        let before = self.persisted();
        self.mode = mode;
        if mode == Mode::Off {
            self.override_ = None;
        }
        self.persisted() != before
    }

    /// Replace the schedule. An active override now ends at the *new*
    /// schedule's next transition after `now`. Returns true if the override
    /// changed (so the caller persists it).
    pub fn set_schedule(&mut self, schedule: Schedule, now: DateTime<Utc>) -> bool {
        self.schedule = schedule;
        match self.active_override(now) {
            Some(o) => {
                let until = self.override_until(now);
                self.override_ = Some(Override { until, ..o });
                until != o.until
            }
            None => false,
        }
    }

    /// Drop the override once it has expired. Returns true if it was dropped.
    pub fn expire_override(&mut self, now: DateTime<Utc>) -> bool {
        if self.override_.is_some() && self.active_override(now).is_none() {
            self.override_ = None;
            true
        } else {
            false
        }
    }

    pub fn on_heatlink_status(&mut self, status: HeatlinkStatus, now: DateTime<Utc>) {
        self.heatlink = Some(HeatlinkView {
            mode: status.mode,
            relay: status.relay,
            switch: status.switch,
            seen: now,
        });
    }

    fn effective(&self, now: DateTime<Utc>) -> (f32, Basis) {
        if self.mode == Mode::Off {
            return (self.params.frost_c, Basis::ModeOff);
        }
        if let Some(o) = self.active_override(now) {
            return (o.setpoint, Basis::Override);
        }
        match self.scheduled_setpoint(now) {
            Some(sp) => (sp, Basis::Schedule),
            None => (self.params.frost_c, Basis::NoSchedule),
        }
    }

    /// The setpoint the loop is acting on at `now`.
    pub fn effective_setpoint(&self, now: DateTime<Utc>) -> f32 {
        self.effective(now).0
    }

    /// Run one step of the control loop. Returns the demand to send, or `None`
    /// if the sensor is stale (send nothing; the heatlink will fall back).
    pub fn evaluate(&mut self, now: DateTime<Utc>) -> Option<Demand> {
        let reading = match self.reading {
            Some(r) if !self.is_stale(now) => r,
            _ => {
                self.last_demand = None;
                return None;
            }
        };
        let (sp, basis) = self.effective(now);
        let t = reading.temperature;
        let want = if self.demand_on {
            t < sp + self.params.hysteresis_above_c
        } else {
            t < sp - self.params.hysteresis_below_c
        };
        if want != self.demand_on {
            let guarded = self.last_change.is_some_and(|(at, sp_then)| {
                now - at < self.params.min_cycle
                    && (sp - sp_then).abs() < self.params.setpoint_jump_c
            });
            if !guarded {
                self.demand_on = want;
                self.last_change = Some((now, sp));
            }
        }
        let source = match basis {
            Basis::Schedule => Source::Schedule,
            Basis::Override => Source::Override,
            Basis::NoSchedule => Source::Frost,
            Basis::ModeOff if self.demand_on => Source::Frost,
            Basis::ModeOff => Source::Off,
        };
        let demand = Demand {
            on: self.demand_on,
            source,
            setpoint: sp,
            temperature: t,
        };
        self.last_demand = Some(demand);
        Some(demand)
    }

    /// The `pi/state` object as of the last [`Controller::evaluate`].
    pub fn state(&self, now: DateTime<Utc>) -> PiState {
        PiState {
            timestamp: now,
            temperature: self.reading.map(|r| r.temperature),
            humidity: self.reading.map(|r| r.humidity),
            mode: self.mode,
            setpoint: self.effective_setpoint(now),
            scheduled_setpoint: self.scheduled_setpoint(now),
            override_: self.active_override(now),
            demand: self.last_demand.is_some_and(|d| d.on),
            demand_source: self.last_demand.map(|d| d.source),
            heatlink: self.heatlink.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::{DayOfWeek, TimeOfDay, default_schedule};
    use chrono::FixedOffset;

    /// Monday 19 Oct 2026, hh:mm UTC.
    fn at(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 19, h, m, 0).unwrap()
    }

    /// A flat 20 °C schedule (one entry), so the setpoint never moves.
    fn flat(target: f32) -> Schedule {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, TimeOfDay::new(0, 0), target);
        s
    }

    fn ctl(schedule: Schedule) -> Controller<Utc> {
        Controller::new(
            ControlParams::default(),
            Utc,
            schedule,
            Persisted::default(),
        )
    }

    fn step(c: &mut Controller<Utc>, t: f32, now: DateTime<Utc>) -> Option<Demand> {
        assert!(c.record_reading(t, 45.0, now));
        c.evaluate(now)
    }

    // ── Effective setpoint ──────────────────────────────────────────────────

    #[test]
    fn effective_setpoint_follows_schedule() {
        let c = ctl(default_schedule());
        assert_eq!(c.effective_setpoint(at(7, 30)), 20.0);
        assert_eq!(c.effective_setpoint(at(12, 0)), 16.0);
        assert_eq!(c.scheduled_setpoint(at(12, 0)), Some(16.0));
    }

    #[test]
    fn effective_setpoint_uses_local_time_zone() {
        // 06:30Z is 07:30 BST → morning 20 °C, not overnight 14 °C.
        let bst = FixedOffset::east_opt(3600).unwrap();
        let c = Controller::new(
            ControlParams::default(),
            bst,
            default_schedule(),
            Persisted::default(),
        );
        assert_eq!(c.effective_setpoint(at(6, 30)), 20.0);
    }

    #[test]
    fn mode_off_uses_frost_floor() {
        let mut c = ctl(default_schedule());
        c.set_mode(Mode::Off);
        assert_eq!(c.effective_setpoint(at(18, 0)), 7.0);
    }

    #[test]
    fn empty_schedule_uses_frost_floor() {
        let c = ctl(Schedule::new());
        assert_eq!(c.effective_setpoint(at(18, 0)), 7.0);
        assert_eq!(c.scheduled_setpoint(at(18, 0)), None);
    }

    // ── Overrides (STAT-47) ─────────────────────────────────────────────────

    #[test]
    fn override_lasts_until_next_transition() {
        let mut c = ctl(default_schedule());
        let o = c.set_override(22.5, at(10, 0)).unwrap();
        assert_eq!(o.until, at(17, 0));
        assert_eq!(c.effective_setpoint(at(16, 59)), 22.5);
        // At the transition the schedule takes over again.
        assert_eq!(c.effective_setpoint(at(17, 0)), 20.0);
        assert_eq!(c.active_override(at(17, 0)), None);
    }

    #[test]
    fn override_until_uses_local_time_zone() {
        let bst = FixedOffset::east_opt(3600).unwrap();
        let mut c = Controller::new(
            ControlParams::default(),
            bst,
            default_schedule(),
            Persisted::default(),
        );
        // 10:00Z = 11:00 BST → next transition 17:00 BST = 16:00Z.
        assert_eq!(c.set_override(21.0, at(10, 0)).unwrap().until, at(16, 0));
    }

    #[test]
    fn override_without_schedule_lasts_a_day() {
        let mut c = ctl(Schedule::new());
        let o = c.set_override(21.0, at(10, 0)).unwrap();
        assert_eq!(o.until, at(10, 0) + Duration::hours(24));
        assert_eq!(c.effective_setpoint(at(11, 0)), 21.0);
    }

    #[test]
    fn override_rejects_out_of_range_and_nan() {
        let mut c = ctl(default_schedule());
        assert!(c.set_override(-0.5, at(10, 0)).is_err());
        assert!(c.set_override(30.5, at(10, 0)).is_err());
        assert!(c.set_override(f32::NAN, at(10, 0)).is_err());
        assert!(c.set_override(f32::INFINITY, at(10, 0)).is_err());
        assert!(c.set_override(0.0, at(10, 0)).is_ok());
        assert!(c.set_override(30.0, at(10, 0)).is_ok());
    }

    #[test]
    fn new_override_replaces_old() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        c.set_override(19.0, at(10, 5)).unwrap();
        assert_eq!(c.effective_setpoint(at(10, 6)), 19.0);
    }

    #[test]
    fn expire_override_only_after_until() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        assert!(!c.expire_override(at(16, 59)));
        assert!(c.persisted().override_.is_some());
        assert!(c.expire_override(at(17, 0)));
        assert!(c.persisted().override_.is_none());
        assert!(!c.expire_override(at(17, 1)));
    }

    #[test]
    fn mode_off_cancels_override_and_wins() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        assert!(c.set_mode(Mode::Off));
        assert_eq!(c.persisted().override_, None);
        assert_eq!(c.effective_setpoint(at(10, 1)), 7.0);
        assert!(!c.set_mode(Mode::Off), "no change the second time");
        assert!(c.set_mode(Mode::Heat));
        assert_eq!(c.effective_setpoint(at(10, 1)), 16.0);
    }

    #[test]
    fn setpoint_while_off_switches_back_to_heat() {
        // "Alexa, set the heating to 22" while off means "heat to 22".
        let mut c = ctl(default_schedule());
        c.set_mode(Mode::Off);
        assert_eq!(c.mode(), Mode::Off);
        c.set_override(22.0, at(10, 0)).unwrap();
        assert_eq!(c.mode(), Mode::Heat);
        assert_eq!(c.effective_setpoint(at(10, 1)), 22.0);
        assert_eq!(c.persisted().mode, Mode::Heat);
    }

    #[test]
    fn rejected_setpoint_while_off_stays_off() {
        let mut c = ctl(default_schedule());
        c.set_mode(Mode::Off);
        assert!(c.set_override(99.0, at(10, 0)).is_err());
        assert_eq!(c.mode(), Mode::Off);
    }

    #[test]
    fn new_schedule_keeps_override_until_its_next_transition() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        // A schedule with a transition at 12:00 ends the override then, not at
        // the old schedule's 17:00.
        let mut s = flat(18.0);
        s.add(DayOfWeek::Mon, TimeOfDay::new(12, 0), 19.0);
        assert!(c.set_schedule(s, at(11, 0)));
        assert_eq!(c.active_override(at(11, 0)).unwrap().until, at(12, 0));
        assert_eq!(c.effective_setpoint(at(11, 59)), 22.0);
        assert_eq!(c.effective_setpoint(at(12, 0)), 19.0);
        assert_eq!(c.schedule().entries(DayOfWeek::Mon).len(), 2);
    }

    #[test]
    fn new_schedule_can_extend_override() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        // Single Monday-midnight entry: the next transition is a week away.
        assert!(c.set_schedule(flat(18.0), at(11, 0)));
        let until = c.active_override(at(11, 0)).unwrap().until;
        assert_eq!(until, Utc.with_ymd_and_hms(2026, 10, 26, 0, 0, 0).unwrap());
    }

    #[test]
    fn new_schedule_without_override_changes_no_override() {
        let mut c = ctl(default_schedule());
        assert!(!c.set_schedule(flat(18.0), at(11, 0)));
        assert_eq!(c.persisted().override_, None);
        // An expired override is left for expire_override to drop.
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        assert!(!c.set_schedule(flat(18.0), at(17, 30)));
        assert_eq!(c.persisted().override_.unwrap().until, at(17, 0));
    }

    #[test]
    fn persisted_state_restores_mode_and_override() {
        let mut c = ctl(default_schedule());
        c.set_override(21.5, at(10, 0)).unwrap();
        let p = c.persisted();
        let restored = Controller::new(ControlParams::default(), Utc, default_schedule(), p);
        assert_eq!(restored.persisted().mode, Mode::Heat);
        assert_eq!(restored.effective_setpoint(at(11, 0)), 21.5);
    }

    // ── Hysteresis ──────────────────────────────────────────────────────────

    #[test]
    fn demand_turns_on_below_setpoint_minus_hysteresis() {
        let mut c = ctl(flat(20.0));
        assert!(!step(&mut c, 19.8, at(10, 0)).unwrap().on, "inside band");
        assert!(step(&mut c, 19.6, at(10, 1)).unwrap().on);
    }

    #[test]
    fn demand_on_threshold_is_strict() {
        let p = ControlParams::default();
        let mut c = ctl(flat(20.0));
        let edge = 20.0 - p.hysteresis_below_c;
        assert!(!step(&mut c, edge, at(10, 0)).unwrap().on);
    }

    #[test]
    fn demand_stays_on_until_setpoint_plus_hysteresis() {
        let p = ControlParams::default();
        let mut c = ctl(flat(20.0));
        assert!(step(&mut c, 19.0, at(10, 0)).unwrap().on);
        assert!(step(&mut c, 20.1, at(10, 10)).unwrap().on, "still in band");
        let edge = 20.0 + p.hysteresis_above_c;
        assert!(
            !step(&mut c, edge, at(10, 20)).unwrap().on,
            "off at ≥ SP+0.2"
        );
    }

    #[test]
    fn demand_stays_off_inside_band_after_turning_off() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 19.0, at(10, 0));
        step(&mut c, 20.5, at(10, 10));
        assert!(!step(&mut c, 19.9, at(10, 20)).unwrap().on);
        assert!(!step(&mut c, 19.75, at(10, 30)).unwrap().on);
    }

    #[test]
    fn demand_carries_setpoint_temperature_and_source() {
        let mut c = ctl(flat(20.0));
        let d = step(&mut c, 18.5, at(10, 0)).unwrap();
        assert_eq!(
            d,
            Demand {
                on: true,
                source: Source::Schedule,
                setpoint: 20.0,
                temperature: 18.5
            }
        );
    }

    // ── Short-cycle guard ───────────────────────────────────────────────────

    #[test]
    fn guard_holds_demand_for_three_minutes() {
        let mut c = ctl(flat(20.0));
        assert!(step(&mut c, 19.0, at(10, 0)).unwrap().on);
        // Overshoots at once — but the guard holds it on.
        assert!(step(&mut c, 21.0, at(10, 1)).unwrap().on);
        assert!(
            step(&mut c, 21.0, at(10, 0) + Duration::seconds(179))
                .unwrap()
                .on
        );
        assert!(
            !step(&mut c, 21.0, at(10, 3)).unwrap().on,
            "released at 3 min"
        );
    }

    #[test]
    fn guard_holds_off_too() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 19.0, at(10, 0));
        assert!(!step(&mut c, 21.0, at(10, 5)).unwrap().on);
        assert!(!step(&mut c, 19.0, at(10, 6)).unwrap().on, "held off");
        assert!(step(&mut c, 19.0, at(10, 8)).unwrap().on);
    }

    #[test]
    fn first_decision_is_not_guarded() {
        let mut c = ctl(flat(20.0));
        assert!(step(&mut c, 19.0, at(10, 0)).unwrap().on);
    }

    #[test]
    fn setpoint_jump_of_one_degree_bypasses_guard() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 19.5, at(10, 0)); // on (19.5 < 19.7)
        c.set_override(19.0, at(10, 1)).unwrap(); // 1 °C down
        assert!(!step(&mut c, 19.5, at(10, 1)).unwrap().on);
    }

    #[test]
    fn small_setpoint_move_does_not_bypass_guard() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 19.5, at(10, 0));
        c.set_override(19.1, at(10, 1)).unwrap(); // 0.9 °C
        assert!(step(&mut c, 19.5, at(10, 1)).unwrap().on);
    }

    #[test]
    fn mode_off_stops_demand_immediately() {
        let mut c = ctl(flat(20.0));
        assert!(step(&mut c, 18.0, at(10, 0)).unwrap().on);
        c.set_mode(Mode::Off);
        let d = step(&mut c, 18.0, at(10, 0) + Duration::seconds(10)).unwrap();
        assert!(!d.on);
        assert_eq!(d.source, Source::Off);
        assert_eq!(d.setpoint, 7.0);
    }

    // ── Sources ─────────────────────────────────────────────────────────────

    #[test]
    fn source_is_override_while_override_active() {
        let mut c = ctl(default_schedule());
        c.set_override(22.0, at(10, 0)).unwrap();
        assert_eq!(
            step(&mut c, 21.0, at(10, 0)).unwrap().source,
            Source::Override
        );
    }

    #[test]
    fn source_is_frost_when_off_and_freezing() {
        let mut c = ctl(default_schedule());
        c.set_mode(Mode::Off);
        let d = step(&mut c, 5.0, at(10, 0)).unwrap();
        assert!(d.on);
        assert_eq!(d.source, Source::Frost);
    }

    #[test]
    fn source_is_frost_with_empty_schedule() {
        let mut c = ctl(Schedule::new());
        assert_eq!(step(&mut c, 15.0, at(10, 0)).unwrap().source, Source::Frost);
        assert_eq!(step(&mut c, 5.0, at(10, 5)).unwrap().source, Source::Frost);
    }

    // ── Stale sensor ────────────────────────────────────────────────────────

    #[test]
    fn no_reading_means_no_demand() {
        let mut c = ctl(flat(20.0));
        assert!(c.is_stale(at(10, 0)));
        assert_eq!(c.evaluate(at(10, 0)), None);
    }

    #[test]
    fn stale_after_five_minutes_without_good_reading() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 18.0, at(10, 0));
        assert!(
            c.evaluate(at(10, 5)).is_some(),
            "exactly 5 min is not stale"
        );
        assert_eq!(c.evaluate(at(10, 0) + Duration::seconds(301)), None);
        let s = c.state(at(10, 6));
        assert!(!s.demand);
        assert_eq!(s.demand_source, None);
    }

    #[test]
    fn implausible_readings_are_not_good() {
        let mut c = ctl(flat(20.0));
        assert!(!c.record_reading(f32::NAN, 40.0, at(10, 0)));
        assert!(!c.record_reading(85.0, 40.0, at(10, 0)));
        assert!(!c.record_reading(-40.0, 40.0, at(10, 0)));
        assert!(!c.record_reading(20.0, f32::NAN, at(10, 0)));
        assert!(c.is_stale(at(10, 0)));
    }

    #[test]
    fn recovers_when_readings_resume() {
        let mut c = ctl(flat(20.0));
        step(&mut c, 18.0, at(10, 0));
        assert_eq!(c.evaluate(at(10, 10)), None);
        assert!(step(&mut c, 18.0, at(10, 11)).unwrap().on);
    }

    // ── State ───────────────────────────────────────────────────────────────

    #[test]
    fn state_serialises_to_spec_shape() {
        let mut c = ctl(default_schedule());
        c.set_override(20.5, at(10, 0)).unwrap();
        c.on_heatlink_status(
            HeatlinkStatus {
                mode: "auto".into(),
                relay: true,
                switch: "auto".into(),
            },
            at(10, 0),
        );
        assert!(c.record_reading(19.75, 45.25, at(10, 1)));
        c.evaluate(at(10, 1));
        let v = serde_json::to_value(c.state(at(10, 1))).unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "timestamp": "2026-10-19T10:01:00Z",
                "temperature": 19.75,
                "humidity": 45.25,
                "mode": "heat",
                "setpoint": 20.5,
                "scheduled_setpoint": 16.0,
                "override": {"setpoint": 20.5, "until": "2026-10-19T17:00:00Z"},
                "demand": true,
                "demand_source": "override",
                "heatlink": {"mode": "auto", "relay": true, "switch": "auto", "seen": "2026-10-19T10:00:00Z"}
            })
        );
    }

    #[test]
    fn state_with_nothing_known_uses_nulls() {
        let c = ctl(Schedule::new());
        let v = serde_json::to_value(c.state(at(10, 0))).unwrap();
        assert_eq!(v["temperature"], serde_json::Value::Null);
        assert_eq!(v["override"], serde_json::Value::Null);
        assert_eq!(v["heatlink"], serde_json::Value::Null);
        assert_eq!(v["scheduled_setpoint"], serde_json::Value::Null);
        assert_eq!(v["demand"], false);
        assert_eq!(v["setpoint"], 7.0);
    }

    #[test]
    fn change_key_ignores_timestamp_readings_and_seen() {
        let mut c = ctl(flat(20.0));
        c.on_heatlink_status(
            HeatlinkStatus {
                mode: "auto".into(),
                relay: false,
                switch: "auto".into(),
            },
            at(10, 0),
        );
        step(&mut c, 19.9, at(10, 0));
        let a = c.state(at(10, 0)).change_key();
        c.on_heatlink_status(
            HeatlinkStatus {
                mode: "auto".into(),
                relay: false,
                switch: "auto".into(),
            },
            at(10, 1),
        );
        step(&mut c, 19.8, at(10, 1));
        assert_eq!(a, c.state(at(10, 1)).change_key());
        step(&mut c, 19.0, at(10, 2));
        assert_ne!(a, c.state(at(10, 2)).change_key(), "demand changed");
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    #[test]
    fn persisted_json_shape() {
        let p = Persisted {
            mode: Mode::Off,
            override_: Some(Override {
                setpoint: 21.0,
                until: at(17, 0),
            }),
        };
        assert_eq!(
            serde_json::to_value(p).unwrap(),
            serde_json::json!({"mode":"off","override":{"setpoint":21.0,"until":"2026-10-19T17:00:00Z"}})
        );
    }

    #[test]
    fn persisted_save_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/control.json");
        let p = Persisted {
            mode: Mode::Off,
            override_: Some(Override {
                setpoint: 21.0,
                until: at(17, 0),
            }),
        };
        p.save(&path).unwrap();
        assert_eq!(Persisted::load(&path), p);
    }

    #[test]
    fn persisted_load_missing_corrupt_or_unreadable_gives_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            Persisted::load(&dir.path().join("nope.json")),
            Persisted::default()
        );
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "{nope").unwrap();
        assert_eq!(Persisted::load(&bad), Persisted::default());
        assert_eq!(Persisted::load(dir.path()), Persisted::default());
    }

    #[test]
    fn persisted_load_tolerates_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.json");
        std::fs::write(&path, "{}").unwrap();
        assert_eq!(Persisted::load(&path), Persisted::default());
    }

    #[test]
    fn persisted_save_fails_on_unwritable_dir() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        std::fs::write(&file, "x").unwrap();
        // Parent is a regular file → create_dir_all fails.
        assert!(Persisted::default().save(&file.join("c.json")).is_err());
    }

    #[test]
    fn ts_rejects_bad_timestamps() {
        let r: Result<Override, _> =
            serde_json::from_str(r#"{"setpoint":20.0,"until":"yesterday"}"#);
        assert!(r.is_err());
    }
}
