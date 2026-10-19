//! MQTT topics and payloads (spec *Topic and payload contracts*). Parsing of
//! inbound messages and serialisation of outbound ones, kept pure so they can
//! be tested against the exact JSON in the spec.

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::control::{Demand, HeatlinkStatus, Mode, Source, ts};
use crate::schedule::Schedule;

pub use crate::schedule::MAX_ENTRIES_PER_DAY;

/// The heatlink clamps `ttl_s` to this range; the daemon does the same so it
/// never claims a TTL the heatlink would not honour.
pub const TTL_RANGE_S: std::ops::RangeInclusive<u32> = 60..=1800;

/// Every topic the daemon publishes or subscribes to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Topics {
    pub readings: String,
    pub api_setpoint: String,
    pub pish_setpoint: String,
    pub api_mode: String,
    pub api_schedule: String,
    pub pi_state: String,
    pub pi_schedule: String,
    pub heatlink_commands: String,
    pub heatlink_status: String,
}

impl Topics {
    /// `env` is `sandbox` or `prod`; `readings` is the configured readings
    /// topic (kept as-is for backwards compatibility); `thing` is the heatlink
    /// Thing name.
    pub fn new(env: &str, readings: &str, thing: &str) -> Self {
        let pi = |suffix: &str| format!("nakostat/{env}/{suffix}");
        Self {
            readings: readings.to_owned(),
            api_setpoint: pi("api/setpoint"),
            pish_setpoint: pi("pish/setpoint"),
            api_mode: pi("api/mode"),
            api_schedule: pi("api/schedule"),
            pi_state: pi("pi/state"),
            pi_schedule: pi("pi/schedule"),
            heatlink_commands: format!("nakostat/{thing}/commands"),
            heatlink_status: format!("nakostat/{thing}/status"),
        }
    }

    /// The topics to subscribe to on (re)connect.
    pub fn subscriptions(&self) -> [&str; 5] {
        [
            &self.api_setpoint,
            &self.pish_setpoint,
            &self.api_mode,
            &self.api_schedule,
            &self.heatlink_status,
        ]
    }

    /// Parse a message on one of the subscribed topics.
    pub fn parse(&self, topic: &str, payload: &str) -> Result<Inbound> {
        if topic == self.api_setpoint || topic == self.pish_setpoint {
            let m: SetpointMsg = serde_json::from_str(payload).context("setpoint payload")?;
            Ok(Inbound::Setpoint {
                temperature: m.temperature,
                user_id: m.user_id,
            })
        } else if topic == self.api_mode {
            let m: ModeMsg = serde_json::from_str(payload).context("mode payload")?;
            Ok(Inbound::Mode {
                mode: m.mode,
                user_id: m.user_id,
            })
        } else if topic == self.api_schedule {
            let m: ScheduleMsg = serde_json::from_str(payload).context("schedule payload")?;
            Ok(Inbound::Schedule {
                schedule: validate_schedule(&m.schedule)?,
                user_id: m.user_id,
            })
        } else if topic == self.heatlink_status {
            let s: HeatlinkStatus =
                serde_json::from_str(payload).context("heatlink status payload")?;
            Ok(Inbound::HeatlinkStatus(s))
        } else {
            bail!("unexpected topic {topic}")
        }
    }
}

/// A parsed inbound message.
#[derive(Debug, Clone)]
pub enum Inbound {
    Setpoint {
        temperature: f32,
        user_id: Option<String>,
    },
    Mode {
        mode: Mode,
        user_id: Option<String>,
    },
    Schedule {
        schedule: Schedule,
        user_id: Option<String>,
    },
    HeatlinkStatus(HeatlinkStatus),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetpointMsg {
    temperature: f32,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModeMsg {
    mode: Mode,
    #[serde(default)]
    user_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleMsg {
    schedule: serde_json::Value,
    #[serde(default)]
    user_id: Option<String>,
}

/// Strictly validate a schedule received from the API: it must parse with no
/// dropped entries, must not be empty, and no day may hold more entries than
/// the heatlink can store. (A schedule loaded from disk is parsed leniently
/// instead; see [`crate::schedule::load_or_default`].)
pub fn validate_schedule(value: &serde_json::Value) -> Result<Schedule> {
    let (schedule, warnings) = Schedule::from_json(&value.to_string())?;
    if !warnings.is_empty() {
        return Err(anyhow!("invalid schedule: {}", warnings.join("; ")));
    }
    if schedule.is_empty() {
        bail!("invalid schedule: no entries");
    }
    if schedule.max_entries_per_day() > MAX_ENTRIES_PER_DAY {
        bail!("invalid schedule: more than {MAX_ENTRIES_PER_DAY} entries on one day");
    }
    Ok(schedule)
}

#[derive(Serialize)]
struct DemandCmd {
    command: &'static str,
    on: bool,
    source: Source,
    setpoint: f32,
    temperature: f32,
    ttl_s: u32,
    ts: i64,
}

/// `{"command":"demand","on":…,"source":…,"setpoint":…,"temperature":…,"ttl_s":…,"ts":…}`
///
/// `ts` is `now` in Unix seconds: the heatlink ignores a demand more than 60 s
/// old (one replayed from a queue after an outage) when its own clock is valid.
pub fn demand_command(d: &Demand, ttl_s: u32, now: DateTime<Utc>) -> String {
    serde_json::to_string(&DemandCmd {
        command: "demand",
        on: d.on,
        source: d.source,
        setpoint: d.setpoint,
        temperature: d.temperature,
        ttl_s: ttl_s.clamp(*TTL_RANGE_S.start(), *TTL_RANGE_S.end()),
        ts: now.timestamp(),
    })
    .expect("demand serialises")
}

#[derive(Serialize)]
struct SetScheduleCmd<'a> {
    command: &'static str,
    enabled: bool,
    tz: &'a str,
    comfort_c: f32,
    duty_pct: u8,
    days: Vec<Vec<(u16, f32)>>,
}

/// `{"command":"set_schedule","enabled":…,"tz":…,"comfort_c":…,"duty_pct":…,"days":[…7 days, Mon first]}`
///
/// `enabled` is false while the daemon's mode is off, so the heatlink's
/// fallback keeps the relay off rather than heating a house switched off.
pub fn set_schedule_command(
    schedule: &Schedule,
    enabled: bool,
    tz: &str,
    comfort_c: f32,
    duty_pct: u8,
) -> String {
    serde_json::to_string(&SetScheduleCmd {
        command: "set_schedule",
        enabled,
        tz,
        comfort_c,
        duty_pct,
        days: schedule.compact_days(MAX_ENTRIES_PER_DAY),
    })
    .expect("set_schedule serialises")
}

#[derive(Serialize)]
struct PiScheduleMsg {
    schedule: serde_json::Value,
    #[serde(with = "ts")]
    timestamp: DateTime<Utc>,
}

/// `{"schedule":<Schedule JSON>,"timestamp":"…Z"}`
pub fn pi_schedule_message(schedule: &Schedule, now: DateTime<Utc>) -> String {
    serde_json::to_string(&PiScheduleMsg {
        schedule: schedule.to_value(),
        timestamp: now,
    })
    .expect("pi/schedule serialises")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::{DayOfWeek, TimeOfDay, default_schedule};
    use chrono::TimeZone;
    use serde_json::{Value, json};

    fn topics() -> Topics {
        Topics::new(
            "sandbox",
            "nakostat/sandbox/pi/readings",
            "nakostat-heatlink",
        )
    }

    fn parse_value(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn topics_match_spec() {
        let t = topics();
        assert_eq!(t.api_setpoint, "nakostat/sandbox/api/setpoint");
        assert_eq!(t.pish_setpoint, "nakostat/sandbox/pish/setpoint");
        assert_eq!(t.api_mode, "nakostat/sandbox/api/mode");
        assert_eq!(t.api_schedule, "nakostat/sandbox/api/schedule");
        assert_eq!(t.pi_state, "nakostat/sandbox/pi/state");
        assert_eq!(t.pi_schedule, "nakostat/sandbox/pi/schedule");
        assert_eq!(t.readings, "nakostat/sandbox/pi/readings");
        assert_eq!(t.heatlink_commands, "nakostat/nakostat-heatlink/commands");
        assert_eq!(t.heatlink_status, "nakostat/nakostat-heatlink/status");
        assert_eq!(
            t.subscriptions(),
            [
                "nakostat/sandbox/api/setpoint",
                "nakostat/sandbox/pish/setpoint",
                "nakostat/sandbox/api/mode",
                "nakostat/sandbox/api/schedule",
                "nakostat/nakostat-heatlink/status",
            ]
        );
    }

    #[test]
    fn parses_setpoint_from_api_and_pish() {
        let t = topics();
        let payload = r#"{"temperature":21.0,"timestamp":"2026-10-19T10:00:00Z","userId":"nakostat-pish-prod"}"#;
        for topic in [&t.api_setpoint, &t.pish_setpoint] {
            match t.parse(topic, payload).unwrap() {
                Inbound::Setpoint {
                    temperature,
                    user_id,
                } => {
                    assert_eq!(temperature, 21.0);
                    assert_eq!(user_id.as_deref(), Some("nakostat-pish-prod"));
                }
                other => panic!("{other:?}"),
            }
        }
    }

    #[test]
    fn setpoint_without_user_id_is_accepted() {
        let t = topics();
        assert!(matches!(
            t.parse(&t.api_setpoint, r#"{"temperature":19.5}"#).unwrap(),
            Inbound::Setpoint { user_id: None, .. }
        ));
    }

    #[test]
    fn rejects_bad_setpoint() {
        let t = topics();
        assert!(t.parse(&t.api_setpoint, r#"{"temp":21}"#).is_err());
        assert!(t.parse(&t.api_setpoint, "not json").is_err());
    }

    #[test]
    fn parses_mode() {
        let t = topics();
        for (s, m) in [("heat", Mode::Heat), ("off", Mode::Off)] {
            let payload =
                format!(r#"{{"mode":"{s}","timestamp":"2026-10-19T10:00:00Z","userId":"u"}}"#);
            match t.parse(&t.api_mode, &payload).unwrap() {
                Inbound::Mode { mode, user_id } => {
                    assert_eq!(mode, m);
                    assert_eq!(user_id.as_deref(), Some("u"));
                }
                other => panic!("{other:?}"),
            }
        }
        assert!(t.parse(&t.api_mode, r#"{"mode":"cool"}"#).is_err());
    }

    #[test]
    fn parses_schedule() {
        let t = topics();
        let payload = r#"{"schedule":{"Mon":[{"at":"07:00","targetC":20.0}],"Tue":[]},"timestamp":"2026-10-19T10:00:00Z","userId":"u"}"#;
        match t.parse(&t.api_schedule, payload).unwrap() {
            Inbound::Schedule { schedule, user_id } => {
                assert_eq!(schedule.entries(DayOfWeek::Mon).len(), 1);
                assert_eq!(user_id.as_deref(), Some("u"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn rejects_invalid_schedules() {
        let t = topics();
        for bad in [
            r#"{"schedule":{"Mon":[{"at":"25:00","targetC":20.0}]}}"#,
            r#"{"schedule":{"Mon":[{"at":"07:00","targetC":40.0}]}}"#,
            r#"{"schedule":{"Funday":[{"at":"07:00","targetC":20.0}]}}"#,
            r#"{"schedule":{}}"#,
            r#"{"schedule":[]}"#,
            r#"{"nope":1}"#,
        ] {
            assert!(t.parse(&t.api_schedule, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rejects_schedule_with_too_many_entries_a_day() {
        let entries: Vec<Value> = (0..9)
            .map(|h| json!({"at": format!("{h:02}:00"), "targetC": 18.0}))
            .collect();
        let err = validate_schedule(&json!({ "Wed": entries })).unwrap_err();
        assert!(err.to_string().contains("more than 8"), "{err}");
        let eight: Vec<Value> = (0..8)
            .map(|h| json!({"at": format!("{h:02}:00"), "targetC": 18.0}))
            .collect();
        assert!(validate_schedule(&json!({ "Wed": eight })).is_ok());
    }

    #[test]
    fn parses_heatlink_status_ignoring_extra_fields() {
        let t = topics();
        let payload = r#"{"version":"0.1.0","mode":"fallback","relay":false,"switch":"auto","source":"fallback","demand_age_s":400,"schedule_known":true,"time_valid":true,"rssi":-61,"uptime_s":3600,"reason":"change"}"#;
        match t.parse(&t.heatlink_status, payload).unwrap() {
            Inbound::HeatlinkStatus(s) => {
                assert_eq!(s.mode, "fallback");
                assert!(!s.relay);
                assert_eq!(s.switch, "auto");
            }
            other => panic!("{other:?}"),
        }
        assert!(t.parse(&t.heatlink_status, r#"{"mode":"auto"}"#).is_err());
    }

    #[test]
    fn rejects_unknown_topic() {
        assert!(topics().parse("nakostat/sandbox/pi/state", "{}").is_err());
    }

    #[test]
    fn demand_command_matches_spec() {
        let d = Demand {
            on: true,
            source: Source::Schedule,
            setpoint: 20.5,
            temperature: 19.8,
        };
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 10, 0, 0).unwrap();
        let s = demand_command(&d, 300, now);
        assert_eq!(
            s,
            r#"{"command":"demand","on":true,"source":"schedule","setpoint":20.5,"temperature":19.8,"ttl_s":300,"ts":1792404000}"#
        );
    }

    #[test]
    fn demand_command_sources_and_ttl_clamp() {
        for (src, name) in [
            (Source::Schedule, "schedule"),
            (Source::Override, "override"),
            (Source::Frost, "frost"),
            (Source::Off, "off"),
        ] {
            let d = Demand {
                on: false,
                source: src,
                setpoint: 7.0,
                temperature: 15.0,
            };
            assert_eq!(
                parse_value(&demand_command(&d, 300, Utc::now()))["source"],
                name
            );
        }
        let d = Demand {
            on: false,
            source: Source::Off,
            setpoint: 7.0,
            temperature: 15.0,
        };
        assert_eq!(parse_value(&demand_command(&d, 5, Utc::now()))["ttl_s"], 60);
        assert_eq!(
            parse_value(&demand_command(&d, 99_999, Utc::now()))["ttl_s"],
            1800
        );
    }

    #[test]
    fn set_schedule_command_matches_spec() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, TimeOfDay::new(6, 0), 20.0);
        s.add(DayOfWeek::Mon, TimeOfDay::new(9, 0), 16.0);
        s.add(DayOfWeek::Sun, TimeOfDay::new(22, 30), 14.5);
        let cmd = set_schedule_command(&s, true, "GMT0BST,M3.5.0/1,M10.5.0", 18.0, 67);
        assert_eq!(
            cmd,
            r#"{"command":"set_schedule","enabled":true,"tz":"GMT0BST,M3.5.0/1,M10.5.0","comfort_c":18.0,"duty_pct":67,"days":[[[360,20.0],[540,16.0]],[],[],[],[],[],[[1350,14.5]]]}"#
        );
    }

    #[test]
    fn set_schedule_command_default_schedule_has_seven_days() {
        let v = parse_value(&set_schedule_command(
            &default_schedule(),
            true,
            "GMT0BST,M3.5.0/1,M10.5.0",
            18.0,
            67,
        ));
        let days = v["days"].as_array().unwrap();
        assert_eq!(days.len(), 7);
        assert_eq!(
            days[0],
            json!([[420, 20.0], [540, 16.0], [1020, 20.0], [1320, 14.0]])
        );
        assert_eq!(days[5], json!([[480, 20.0], [1380, 14.0]]));
    }

    #[test]
    fn set_schedule_command_disabled_while_off() {
        let cmd = set_schedule_command(&Schedule::new(), false, "UTC0", 18.0, 67);
        assert_eq!(
            cmd,
            r#"{"command":"set_schedule","enabled":false,"tz":"UTC0","comfort_c":18.0,"duty_pct":67,"days":[[],[],[],[],[],[],[]]}"#
        );
    }

    #[test]
    fn pi_schedule_message_matches_spec() {
        let mut s = Schedule::new();
        s.add(DayOfWeek::Mon, TimeOfDay::new(7, 0), 20.0);
        let now = Utc.with_ymd_and_hms(2026, 10, 19, 10, 0, 0).unwrap();
        let v = parse_value(&pi_schedule_message(&s, now));
        assert_eq!(v["timestamp"], "2026-10-19T10:00:00Z");
        assert_eq!(v["schedule"]["Mon"], json!([{"at":"07:00","targetC":20.0}]));
        assert_eq!(v["schedule"]["Sun"], json!([]));
        // The embedded schedule round-trips through the strict validator.
        assert!(validate_schedule(&v["schedule"]).is_ok());
    }
}
