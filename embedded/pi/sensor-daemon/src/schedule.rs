//! Heating schedule — time-of-day setpoint scheduling, evaluated against the
//! local wall clock (STAT-45 / STAT-46).
//!
//! Model: `Map<DayOfWeek, List<ScheduleEntry>>`. An entry is a *transition
//! point* — "from `at`, hold `target_c` until the next entry". The setpoint in
//! force at any instant is the most recent entry at-or-before now, searching
//! backwards around the weekly cycle, so early Monday inherits Sunday night's
//! last entry (get this wrong and the house is cold every morning before the
//! first entry).
//!
//! The daemon is the source of truth for the schedule: it is persisted to disk
//! as a day-keyed JSON map (see [`load_or_default`]) and falls back to the
//! hard-coded [`default_schedule`] if the file is missing or unreadable.
//!
//! ```json
//! { "Mon": [ {"at":"07:00","targetC":20.0}, {"at":"22:00","targetC":14.0} ], "Tue": [], ... }
//! ```

use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, TimeZone, Timelike};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::BTreeMap;
use std::path::Path;
use tracing::{error, info, warn};

const MINUTES_PER_DAY: i32 = 1440;

/// The heatlink stores at most this many entries a day (`set_schedule`).
pub const MAX_ENTRIES_PER_DAY: usize = 8;

/// Day of the week, ordered Mon..Sun to match the weekly cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum DayOfWeek {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl DayOfWeek {
    /// All seven days, in weekly order.
    pub const ALL: [DayOfWeek; 7] = [
        DayOfWeek::Mon,
        DayOfWeek::Tue,
        DayOfWeek::Wed,
        DayOfWeek::Thu,
        DayOfWeek::Fri,
        DayOfWeek::Sat,
        DayOfWeek::Sun,
    ];

    /// Index in the weekly cycle: Mon = 0 .. Sun = 6.
    pub fn index(self) -> u8 {
        self as u8
    }
}

impl From<chrono::Weekday> for DayOfWeek {
    fn from(w: chrono::Weekday) -> Self {
        match w {
            chrono::Weekday::Mon => DayOfWeek::Mon,
            chrono::Weekday::Tue => DayOfWeek::Tue,
            chrono::Weekday::Wed => DayOfWeek::Wed,
            chrono::Weekday::Thu => DayOfWeek::Thu,
            chrono::Weekday::Fri => DayOfWeek::Fri,
            chrono::Weekday::Sat => DayOfWeek::Sat,
            chrono::Weekday::Sun => DayOfWeek::Sun,
        }
    }
}

/// Lowest and highest target temperatures accepted from a stored schedule.
pub const MIN_TARGET_C: f32 = 0.0;
pub const MAX_TARGET_C: f32 = 30.0;

/// A time of day as minutes since local midnight (0..=1439). Serialised as
/// `"HH:MM"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct TimeOfDay(u16);

impl TimeOfDay {
    /// Construct from hours and minutes. Panics if out of range — intended for
    /// the hard-coded schedule, where inputs are compile-time constants.
    pub fn new(hours: u8, minutes: u8) -> Self {
        assert!(hours < 24, "hours out of range: {hours}");
        assert!(minutes < 60, "minutes out of range: {minutes}");
        TimeOfDay(hours as u16 * 60 + minutes as u16)
    }

    /// Minutes since midnight.
    pub fn minutes(self) -> u16 {
        self.0
    }

    /// Parse `"HH:MM"` (hours 0–23, minutes 0–59).
    pub fn parse(s: &str) -> Option<Self> {
        let (h, m) = s.split_once(':')?;
        if h.is_empty() || h.len() > 2 || m.len() != 2 {
            return None;
        }
        let (h, m) = (h.parse::<u8>().ok()?, m.parse::<u8>().ok()?);
        (h < 24 && m < 60).then(|| TimeOfDay::new(h, m))
    }
}

impl std::fmt::Display for TimeOfDay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:02}:{:02}", self.0 / 60, self.0 % 60)
    }
}

impl Serialize for TimeOfDay {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for TimeOfDay {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        TimeOfDay::parse(&s)
            .ok_or_else(|| serde::de::Error::custom(format!("invalid time {s:?}, expected HH:MM")))
    }
}

/// A single transition point: from `at`, hold `target_c` until the next entry.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub at: TimeOfDay,
    pub target_c: f32,
}

/// A weekly heating schedule. Internally a per-day list of transition points,
/// indexed by [`DayOfWeek`]; an empty day simply holds the previous setpoint.
#[derive(Debug, Clone, Default)]
pub struct Schedule {
    days: [Vec<ScheduleEntry>; 7],
}

impl Schedule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a transition point to a day, keeping that day's entries time-sorted.
    /// An existing entry at the same time is replaced (last wins).
    pub fn add(&mut self, day: DayOfWeek, at: TimeOfDay, target_c: f32) {
        let entries = &mut self.days[day.index() as usize];
        entries.retain(|e| e.at != at);
        entries.push(ScheduleEntry { at, target_c });
        entries.sort_by_key(|e| e.at.minutes());
    }

    /// Parse the day-keyed JSON form. Fails only if the document is not a JSON
    /// object; individual invalid entries (bad day key, bad `"HH:MM"`, `targetC`
    /// outside 0–30 °C) are dropped and described in the returned warnings.
    pub fn from_json(text: &str) -> Result<(Self, Vec<String>)> {
        let raw: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(text).context("schedule is not a JSON object")?;
        let mut schedule = Schedule::new();
        let mut warnings = Vec::new();
        for (key, value) in raw {
            let Ok(day) =
                serde_json::from_value::<DayOfWeek>(serde_json::Value::String(key.clone()))
            else {
                warnings.push(format!("unknown day {key:?}, ignoring its entries"));
                continue;
            };
            let serde_json::Value::Array(items) = value else {
                warnings.push(format!("{key}: expected a list of entries, ignoring"));
                continue;
            };
            for item in items {
                match serde_json::from_value::<ScheduleEntry>(item.clone()) {
                    Err(e) => warnings.push(format!("{key}: dropping invalid entry {item}: {e}")),
                    Ok(e) if !(MIN_TARGET_C..=MAX_TARGET_C).contains(&e.target_c) => {
                        warnings.push(format!(
                            "{key} {}: targetC {} outside 0–30 °C, dropping",
                            e.at, e.target_c
                        ))
                    }
                    Ok(e) => schedule.add(day, e.at, e.target_c),
                }
            }
        }
        Ok((schedule, warnings))
    }

    /// Serialise to the day-keyed JSON form (all seven days, Mon..Sun).
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.to_value()).expect("schedule serialisation cannot fail")
    }

    /// The day-keyed JSON form as a [`serde_json::Value`], for embedding in a
    /// larger message (`pi/schedule`).
    pub fn to_value(&self) -> serde_json::Value {
        let map: BTreeMap<DayOfWeek, &[ScheduleEntry]> = DayOfWeek::ALL
            .into_iter()
            .map(|d| (d, self.entries(d)))
            .collect();
        serde_json::to_value(map).expect("schedule serialisation cannot fail")
    }

    /// True if no day has any entry.
    pub fn is_empty(&self) -> bool {
        self.days.iter().all(Vec::is_empty)
    }

    /// The largest number of entries on any one day.
    pub fn max_entries_per_day(&self) -> usize {
        self.days.iter().map(Vec::len).max().unwrap_or(0)
    }

    /// The days holding more than `max_per_day` entries, Mon first.
    pub fn overfull_days(&self, max_per_day: usize) -> Vec<DayOfWeek> {
        DayOfWeek::ALL
            .into_iter()
            .filter(|&d| self.entries(d).len() > max_per_day)
            .collect()
    }

    /// The compact form the heatlink stores (`set_schedule`): seven days, Mon
    /// first, each a list of `(minute_of_day, target_c)`, truncated to the
    /// first `max_per_day` entries a day (with a warning naming the day).
    pub fn compact_days(&self, max_per_day: usize) -> Vec<Vec<(u16, f32)>> {
        for d in self.overfull_days(max_per_day) {
            warn!(
                "Schedule {d:?} has {} entries; the heatlink gets only the first {max_per_day}",
                self.entries(d).len()
            );
        }
        DayOfWeek::ALL
            .into_iter()
            .map(|d| {
                self.entries(d)
                    .iter()
                    .take(max_per_day)
                    .map(|e| (e.at.minutes(), e.target_c))
                    .collect()
            })
            .collect()
    }

    /// The first schedule transition strictly after `now`, in `now`'s time
    /// zone. Looks up to a week ahead (so a single-entry schedule still has a
    /// next transition). A transition that falls in a DST gap is moved an hour
    /// later. `None` only if the schedule is empty.
    pub fn next_transition_after<Tz: TimeZone>(&self, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
        let tz = now.timezone();
        let today = now.date_naive();
        for offset in 0..=7 {
            let date = today + chrono::Days::new(offset);
            for e in self.entries(DayOfWeek::from(date.weekday())) {
                let minutes = u32::from(e.at.minutes());
                let naive = date
                    .and_hms_opt(minutes / 60, minutes % 60, 0)
                    .expect("TimeOfDay is always a valid time");
                let local = tz.from_local_datetime(&naive).earliest().or_else(|| {
                    tz.from_local_datetime(&(naive + chrono::Duration::hours(1)))
                        .earliest()
                });
                match local {
                    Some(t) if t > *now => return Some(t),
                    _ => {}
                }
            }
        }
        None
    }

    /// Write the schedule to `path` atomically (temp file + rename), creating
    /// the parent directory if needed.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("creating directory {}", dir.display()))?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, self.to_json())
            .with_context(|| format!("writing {}", tmp.display()))?;
        std::fs::rename(&tmp, path).with_context(|| format!("renaming to {}", path.display()))
    }

    /// The transition points for a given day, time-sorted.
    pub fn entries(&self, day: DayOfWeek) -> &[ScheduleEntry] {
        &self.days[day.index() as usize]
    }

    /// The target setpoint in force at the given day + time of day.
    ///
    /// Returns the most recent entry at-or-before that moment, searching
    /// backwards around the weekly cycle (so a moment before the week's first
    /// entry inherits the week's *last* entry). `None` only if the schedule is
    /// completely empty.
    pub fn setpoint_at(&self, day: DayOfWeek, tod: TimeOfDay) -> Option<f32> {
        let now_abs = abs_minute(day, tod);

        // Flatten the week to (absolute-minute-of-week, target), time-ordered.
        let mut points: Vec<(i32, f32)> = Vec::new();
        for d in DayOfWeek::ALL {
            for e in self.entries(d) {
                points.push((abs_minute(d, e.at), e.target_c));
            }
        }
        if points.is_empty() {
            return None;
        }
        points.sort_by_key(|(abs, _)| *abs);

        // Most recent entry at-or-before now; otherwise wrap to the week's last.
        points
            .iter()
            .rev()
            .find(|(abs, _)| *abs <= now_abs)
            .or_else(|| points.last())
            .map(|(_, target)| *target)
    }

    /// The target setpoint in force at the given local instant.
    pub fn current_setpoint<Tz: TimeZone>(&self, now: DateTime<Tz>) -> Option<f32> {
        let day = DayOfWeek::from(now.weekday());
        let tod = TimeOfDay(now.hour() as u16 * 60 + now.minute() as u16);
        self.setpoint_at(day, tod)
    }
}

fn abs_minute(day: DayOfWeek, tod: TimeOfDay) -> i32 {
    day.index() as i32 * MINUTES_PER_DAY + tod.minutes() as i32
}

/// Load the schedule from `path`.
///
/// - Missing file: use [`default_schedule`] and write it out, so the user has
///   something to edit.
/// - Unreadable or corrupt file: use [`default_schedule`], log an error and
///   leave the file alone for diagnosis.
/// - Invalid individual entries are dropped with a warning each.
pub fn load_or_default(path: &Path) -> Schedule {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            info!("No schedule at {}, writing the default", path.display());
            let schedule = default_schedule();
            if let Err(e) = schedule.save(path) {
                warn!("Could not write default schedule: {e:#}");
            }
            return schedule;
        }
        Err(e) => {
            error!(
                "Reading schedule {} failed: {e}; using the default",
                path.display()
            );
            return default_schedule();
        }
    };
    match Schedule::from_json(&text) {
        Ok((schedule, warnings)) => {
            for w in &warnings {
                warn!("Schedule {}: {w}", path.display());
            }
            for d in schedule.overfull_days(MAX_ENTRIES_PER_DAY) {
                warn!(
                    "Schedule {}: {d:?} has {} entries, more than the heatlink's \
                     {MAX_ENTRIES_PER_DAY}; its fallback gets only the first {MAX_ENTRIES_PER_DAY}",
                    path.display(),
                    schedule.entries(d).len()
                );
            }
            info!("Loaded heating schedule from {}", path.display());
            schedule
        }
        Err(e) => {
            error!(
                "Schedule {} is corrupt ({e:#}); using the default",
                path.display()
            );
            default_schedule()
        }
    }
}

/// The built-in fallback schedule, used when no stored schedule is available.
///
/// - Weekdays: 20 °C from 07:00, setback to 16 °C from 09:00 (out), back to
///   20 °C from 17:00, 14 °C overnight from 22:00.
/// - Weekends: 20 °C from 08:00, 14 °C overnight from 23:00.
pub fn default_schedule() -> Schedule {
    let mut s = Schedule::new();
    for day in [
        DayOfWeek::Mon,
        DayOfWeek::Tue,
        DayOfWeek::Wed,
        DayOfWeek::Thu,
        DayOfWeek::Fri,
    ] {
        s.add(day, TimeOfDay::new(7, 0), 20.0);
        s.add(day, TimeOfDay::new(9, 0), 16.0);
        s.add(day, TimeOfDay::new(17, 0), 20.0);
        s.add(day, TimeOfDay::new(22, 0), 14.0);
    }
    for day in [DayOfWeek::Sat, DayOfWeek::Sun] {
        s.add(day, TimeOfDay::new(8, 0), 20.0);
        s.add(day, TimeOfDay::new(23, 0), 14.0);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Local;

    fn tod(h: u8, m: u8) -> TimeOfDay {
        TimeOfDay::new(h, m)
    }

    #[test]
    fn day_index_is_mon_zero_sun_six() {
        assert_eq!(DayOfWeek::Mon.index(), 0);
        assert_eq!(DayOfWeek::Sun.index(), 6);
    }

    #[test]
    fn day_of_week_from_chrono_weekday() {
        use chrono::Weekday;
        assert_eq!(DayOfWeek::from(Weekday::Mon), DayOfWeek::Mon);
        assert_eq!(DayOfWeek::from(Weekday::Tue), DayOfWeek::Tue);
        assert_eq!(DayOfWeek::from(Weekday::Wed), DayOfWeek::Wed);
        assert_eq!(DayOfWeek::from(Weekday::Thu), DayOfWeek::Thu);
        assert_eq!(DayOfWeek::from(Weekday::Fri), DayOfWeek::Fri);
        assert_eq!(DayOfWeek::from(Weekday::Sat), DayOfWeek::Sat);
        assert_eq!(DayOfWeek::from(Weekday::Sun), DayOfWeek::Sun);
    }

    #[test]
    fn time_of_day_minutes() {
        assert_eq!(tod(0, 0).minutes(), 0);
        assert_eq!(tod(7, 30).minutes(), 450);
        assert_eq!(tod(23, 59).minutes(), 1439);
    }

    #[test]
    fn empty_schedule_has_no_setpoint() {
        let s = Schedule::new();
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(12, 0)), None);
    }

    #[test]
    fn single_entry_applies_all_week() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Wed, tod(12, 0), 19.0);
        // At and after the entry.
        assert_eq!(s.setpoint_at(DayOfWeek::Wed, tod(12, 0)), Some(19.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Fri, tod(3, 0)), Some(19.0));
        // Before it, earlier in the week → wraps to the same single entry.
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(0, 0)), Some(19.0));
    }

    #[test]
    fn entry_applies_from_its_time_inclusive() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        s.add(DayOfWeek::Mon, tod(22, 0), 14.0);
        // Before 07:00 Monday → carries over from the week's last entry (22:00).
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(6, 59)), Some(14.0));
        // Boundaries are inclusive of the entry's own time.
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(7, 0)), Some(20.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(21, 59)), Some(20.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(22, 0)), Some(14.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(23, 30)), Some(14.0));
    }

    #[test]
    fn carry_over_across_midnight_into_monday() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Sun, tod(23, 0), 14.0);
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        // Early Monday still sits in Sunday night's setback.
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(6, 0)), Some(14.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(7, 0)), Some(20.0));
    }

    #[test]
    fn wraps_when_now_before_every_entry() {
        // now = Monday 00:00, all entries later in the week → week's last wins.
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        s.add(DayOfWeek::Sun, tod(20, 0), 12.0);
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(0, 0)), Some(12.0));
    }

    #[test]
    fn empty_day_inherits_previous_day() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Sat, tod(8, 0), 21.0);
        // Sunday has no entries of its own → holds Saturday's 21.0 all day.
        assert_eq!(s.setpoint_at(DayOfWeek::Sun, tod(3, 0)), Some(21.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Sun, tod(23, 59)), Some(21.0));
    }

    #[test]
    fn add_keeps_entries_time_sorted() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(22, 0), 14.0);
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        let e = s.entries(DayOfWeek::Mon);
        assert_eq!(e[0].at, tod(7, 0));
        assert_eq!(e[1].at, tod(22, 0));
    }

    #[test]
    fn add_same_time_last_wins() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        s.add(DayOfWeek::Mon, tod(7, 0), 18.0);
        assert_eq!(
            s.entries(DayOfWeek::Mon),
            &[ScheduleEntry {
                at: tod(7, 0),
                target_c: 18.0
            }]
        );
    }

    #[test]
    fn time_of_day_parse_and_display() {
        assert_eq!(TimeOfDay::parse("07:00"), Some(tod(7, 0)));
        assert_eq!(TimeOfDay::parse("7:05"), Some(tod(7, 5)));
        assert_eq!(TimeOfDay::parse("23:59"), Some(tod(23, 59)));
        for bad in [
            "24:00", "12:60", "12", "12:5", ":30", "ab:cd", "-1:00", "123:00",
        ] {
            assert_eq!(TimeOfDay::parse(bad), None, "{bad}");
        }
        assert_eq!(tod(7, 5).to_string(), "07:05");
    }

    #[test]
    fn json_round_trip() {
        let s = default_schedule();
        let json = s.to_json();
        let (back, warnings) = Schedule::from_json(&json).unwrap();
        assert!(warnings.is_empty());
        for d in DayOfWeek::ALL {
            assert_eq!(back.entries(d), s.entries(d));
        }
    }

    #[test]
    fn json_shape_is_day_keyed_with_hh_mm() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        let v: serde_json::Value = serde_json::from_str(&s.to_json()).unwrap();
        assert_eq!(
            v["Mon"],
            serde_json::json!([{"at": "07:00", "targetC": 20.0}])
        );
        assert_eq!(v["Sun"], serde_json::json!([]));
        assert_eq!(v.as_object().unwrap().len(), 7);
    }

    #[test]
    fn from_json_drops_invalid_entries_and_keeps_the_rest() {
        let json = r#"{
            "Mon": [ {"at":"22:00","targetC":14.0}, {"at":"07:00","targetC":20.0},
                     {"at":"25:00","targetC":20.0}, {"at":"08:00","targetC":31.0},
                     {"at":"09:00","targetC":-1.0}, {"at":"07:00","targetC":19.5} ],
            "Funday": [ {"at":"07:00","targetC":20.0} ],
            "Tue": "nope"
        }"#;
        let (s, warnings) = Schedule::from_json(json).unwrap();
        // Sorted, duplicate 07:00 resolved last-wins.
        assert_eq!(
            s.entries(DayOfWeek::Mon),
            &[
                ScheduleEntry {
                    at: tod(7, 0),
                    target_c: 19.5
                },
                ScheduleEntry {
                    at: tod(22, 0),
                    target_c: 14.0
                },
            ]
        );
        assert!(s.entries(DayOfWeek::Tue).is_empty());
        assert_eq!(warnings.len(), 5, "{warnings:?}");
    }

    #[test]
    fn from_json_accepts_boundary_targets() {
        let json = r#"{"Mon":[{"at":"00:00","targetC":0.0},{"at":"12:00","targetC":30.0}]}"#;
        let (s, warnings) = Schedule::from_json(json).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(s.entries(DayOfWeek::Mon).len(), 2);
    }

    #[test]
    fn from_json_rejects_non_object() {
        assert!(Schedule::from_json("[]").is_err());
        assert!(Schedule::from_json("{not json").is_err());
    }

    #[test]
    fn load_missing_file_writes_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/schedule.json");
        let s = load_or_default(&path);
        assert_eq!(
            s.entries(DayOfWeek::Mon),
            default_schedule().entries(DayOfWeek::Mon)
        );
        let (written, _) = Schedule::from_json(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            written.entries(DayOfWeek::Sat),
            default_schedule().entries(DayOfWeek::Sat)
        );
    }

    #[test]
    fn load_corrupt_file_uses_default_and_leaves_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedule.json");
        std::fs::write(&path, "{corrupt").unwrap();
        let s = load_or_default(&path);
        assert_eq!(
            s.entries(DayOfWeek::Fri),
            default_schedule().entries(DayOfWeek::Fri)
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{corrupt");
    }

    #[test]
    fn load_unreadable_path_uses_default() {
        // A directory where the file should be: read fails with a non-NotFound error.
        let dir = tempfile::tempdir().unwrap();
        let s = load_or_default(dir.path());
        assert_eq!(
            s.entries(DayOfWeek::Mon),
            default_schedule().entries(DayOfWeek::Mon)
        );
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedule.json");
        let mut s = Schedule::new();
        s.add(DayOfWeek::Sat, tod(9, 30), 21.5);
        s.save(&path).unwrap();
        let loaded = load_or_default(&path);
        assert_eq!(loaded.entries(DayOfWeek::Sat), s.entries(DayOfWeek::Sat));
        assert!(loaded.entries(DayOfWeek::Mon).is_empty());
    }

    #[test]
    fn default_schedule_weekday_profile() {
        let s = default_schedule();
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(6, 0)), Some(14.0)); // overnight
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(7, 30)), Some(20.0)); // morning
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(12, 0)), Some(16.0)); // daytime setback
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(18, 0)), Some(20.0)); // evening
        assert_eq!(s.setpoint_at(DayOfWeek::Mon, tod(23, 0)), Some(14.0)); // night
    }

    #[test]
    fn default_schedule_weekend_profile() {
        let s = default_schedule();
        // Before 08:00 Saturday carries over from Friday's 22:00 setback.
        assert_eq!(s.setpoint_at(DayOfWeek::Sat, tod(7, 0)), Some(14.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Sat, tod(10, 0)), Some(20.0));
        assert_eq!(s.setpoint_at(DayOfWeek::Sun, tod(23, 30)), Some(14.0));
    }

    #[test]
    fn is_empty_and_max_entries() {
        assert!(Schedule::new().is_empty());
        assert_eq!(Schedule::new().max_entries_per_day(), 0);
        let s = default_schedule();
        assert!(!s.is_empty());
        assert_eq!(s.max_entries_per_day(), 4);
    }

    #[test]
    fn to_value_matches_to_json() {
        let s = default_schedule();
        let v: serde_json::Value = serde_json::from_str(&s.to_json()).unwrap();
        assert_eq!(s.to_value(), v);
    }

    #[test]
    fn compact_days_is_mon_first_minute_of_day() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(6, 0), 20.0);
        s.add(DayOfWeek::Mon, tod(9, 0), 16.0);
        s.add(DayOfWeek::Sun, tod(23, 30), 14.5);
        let days = s.compact_days(8);
        assert_eq!(days.len(), 7);
        assert_eq!(days[0], vec![(360, 20.0), (540, 16.0)]);
        assert!(days[1].is_empty());
        assert_eq!(days[6], vec![(1410, 14.5)]);
    }

    #[test]
    fn overfull_days_names_each_day_over_the_limit() {
        let mut s = default_schedule();
        assert!(s.overfull_days(MAX_ENTRIES_PER_DAY).is_empty());
        for h in 0..9 {
            s.add(DayOfWeek::Thu, tod(h, 30), 15.0);
            s.add(DayOfWeek::Sun, tod(h, 30), 15.0);
        }
        assert_eq!(
            s.overfull_days(MAX_ENTRIES_PER_DAY),
            vec![DayOfWeek::Thu, DayOfWeek::Sun]
        );
    }

    #[test]
    fn load_keeps_overfull_days_from_disk() {
        // Lenient on disk: an overfull day loads (with a warning) rather than
        // falling back to the default; set_schedule then sends the first 8.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedule.json");
        let entries: Vec<String> = (0..10)
            .map(|h| format!(r#"{{"at":"{h:02}:00","targetC":18.0}}"#))
            .collect();
        std::fs::write(&path, format!(r#"{{"Wed":[{}]}}"#, entries.join(","))).unwrap();
        let s = load_or_default(&path);
        assert_eq!(s.entries(DayOfWeek::Wed).len(), 10);
        assert_eq!(s.overfull_days(MAX_ENTRIES_PER_DAY), vec![DayOfWeek::Wed]);
        assert_eq!(s.compact_days(MAX_ENTRIES_PER_DAY)[2].len(), 8);
    }

    #[test]
    fn compact_days_truncates_to_limit() {
        let mut s = Schedule::new();
        for h in 0..10 {
            s.add(DayOfWeek::Tue, tod(h, 0), 15.0);
        }
        let days = s.compact_days(8);
        assert_eq!(days[1].len(), 8);
        assert_eq!(days[1][7], (420, 15.0));
    }

    #[test]
    fn next_transition_later_same_day() {
        use chrono::Utc;
        let s = default_schedule();
        // 2026-10-19 is a Monday.
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 7, 30, 0).unwrap();
        assert_eq!(
            s.next_transition_after(&now),
            Some(Utc.with_ymd_and_hms(2026, 10, 19, 9, 0, 0).unwrap())
        );
    }

    #[test]
    fn next_transition_is_strictly_after_now() {
        use chrono::Utc;
        let s = default_schedule();
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 9, 0, 0).unwrap();
        assert_eq!(
            s.next_transition_after(&now),
            Some(Utc.with_ymd_and_hms(2026, 10, 19, 17, 0, 0).unwrap())
        );
    }

    #[test]
    fn next_transition_rolls_into_following_days() {
        use chrono::Utc;
        let s = default_schedule();
        // Friday 23:00 → Saturday 08:00.
        let now = Utc.with_ymd_and_hms(2026, 10, 23, 23, 0, 0).unwrap();
        assert_eq!(
            s.next_transition_after(&now),
            Some(Utc.with_ymd_and_hms(2026, 10, 24, 8, 0, 0).unwrap())
        );
    }

    #[test]
    fn next_transition_single_entry_is_a_week_later() {
        use chrono::Utc;
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, tod(7, 0), 20.0);
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 8, 0, 0).unwrap();
        assert_eq!(
            s.next_transition_after(&now),
            Some(Utc.with_ymd_and_hms(2026, 10, 26, 7, 0, 0).unwrap())
        );
    }

    #[test]
    fn next_transition_empty_schedule_is_none() {
        use chrono::Utc;
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 8, 0, 0).unwrap();
        assert_eq!(Schedule::new().next_transition_after(&now), None);
    }

    #[test]
    fn next_transition_respects_time_zone_offset() {
        use chrono::FixedOffset;
        let bst = FixedOffset::east_opt(3600).unwrap();
        let s = default_schedule();
        // 06:30 local Monday → 07:00 local, i.e. 06:00Z.
        let now = bst.with_ymd_and_hms(2026, 10, 19, 6, 30, 0).unwrap();
        let next = s.next_transition_after(&now).unwrap();
        assert_eq!(next, bst.with_ymd_and_hms(2026, 10, 19, 7, 0, 0).unwrap());
        assert_eq!(next.naive_utc().to_string(), "2026-10-19 06:00:00");
    }

    #[test]
    fn current_setpoint_uses_local_weekday_and_time() {
        let s = default_schedule();
        // 2026-06-01 is a Monday; 12:00 → daytime setback (16.0).
        let dt = Local.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
        assert_eq!(s.current_setpoint(dt), Some(16.0));
    }
}
