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
//! For the MVP the schedule is hard-coded ([`default_schedule`]). Later stories
//! make it stored, editable and selectable (STAT-46 onwards); the data shape
//! here is chosen so that becomes "swap the source of the rules", not a rewrite.

use chrono::{DateTime, Datelike, TimeZone, Timelike};
use serde::{Deserialize, Serialize};

const MINUTES_PER_DAY: i32 = 1440;

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

/// A time of day as minutes since local midnight (0..=1439).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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
}

/// A single transition point: from `at`, hold `target_c` until the next entry.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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
    pub fn add(&mut self, day: DayOfWeek, at: TimeOfDay, target_c: f32) {
        let entries = &mut self.days[day.index() as usize];
        entries.push(ScheduleEntry { at, target_c });
        entries.sort_by_key(|e| e.at.minutes());
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

/// The MVP hard-coded schedule (STAT-45). Replaced by stored, editable
/// schedules in STAT-46 onwards.
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
    fn current_setpoint_uses_local_weekday_and_time() {
        let s = default_schedule();
        // 2026-06-01 is a Monday; 12:00 → daytime setback (16.0).
        let dt = Local.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
        assert_eq!(s.current_setpoint(dt), Some(16.0));
    }
}
