use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub mqtt: MqttConfig,
    pub sensor: SensorConfig,
    pub socket: SocketConfig,
    #[serde(default)]
    pub schedule: ScheduleConfig,
    #[serde(default)]
    pub control: ControlConfig,
    #[serde(default)]
    pub heatlink: HeatlinkConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MqttConfig {
    pub endpoint: String,
    pub port: u16,
    pub client_id: String,
    pub cert_path: String,
    pub key_path: String,
    pub topic: String,
    /// `sandbox` or `prod`, used in `nakostat/{env}/…` topics. If unset it is
    /// taken from `topic` (`nakostat/{env}/pi/readings`), else `prod`.
    #[serde(default)]
    pub env: Option<String>,
}

impl MqttConfig {
    /// The deployment environment for topic names.
    pub fn env(&self) -> String {
        if let Some(env) = self.env.as_deref().filter(|e| !e.is_empty()) {
            return env.to_owned();
        }
        let mut parts = self.topic.split('/');
        match (parts.next(), parts.next()) {
            (Some("nakostat"), Some(env)) if !env.is_empty() => env.to_owned(),
            _ => "prod".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SensorConfig {
    pub i2c_bus: u8,
    pub publish_interval_s: u64,
    pub warmup_s: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SocketConfig {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScheduleConfig {
    pub path: String,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        Self {
            path: "/var/lib/nakostat/schedule.json".to_string(),
        }
    }
}

/// Control-loop tuning (`[control]`). Defaults are the spec's values.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ControlConfig {
    /// Mode-off setpoint.
    pub frost_c: f32,
    /// Demand on below `setpoint − hysteresis_below_c`.
    pub hysteresis_below_c: f32,
    /// Demand off at or above `setpoint + hysteresis_above_c`.
    pub hysteresis_above_c: f32,
    /// Short-cycle guard: minimum seconds between demand changes.
    pub min_cycle_s: u64,
    /// A setpoint move of at least this many °C bypasses the guard.
    pub setpoint_jump_c: f32,
    /// No good reading for this long → stop sending demand.
    pub stale_after_s: u64,
    /// How often `demand` is re-sent to the heatlink.
    pub demand_interval_s: u64,
    /// How often `pi/state` is published regardless of change.
    pub state_interval_s: u64,
    /// Where mode and override are persisted.
    pub state_path: String,
    /// Send demand even on a mock-sensor build (no `real-sensor` feature),
    /// for bench testing a heatlink. Off by default: a fake temperature must
    /// never drive a real boiler.
    pub allow_mock_demand: bool,
}

impl Default for ControlConfig {
    fn default() -> Self {
        Self {
            frost_c: 7.0,
            hysteresis_below_c: 0.3,
            hysteresis_above_c: 0.2,
            min_cycle_s: 180,
            setpoint_jump_c: 1.0,
            stale_after_s: 300,
            demand_interval_s: 30,
            state_interval_s: 60,
            state_path: "/var/lib/nakostat/control.json".to_string(),
            allow_mock_demand: false,
        }
    }
}

impl ControlConfig {
    pub fn params(&self) -> crate::control::ControlParams {
        crate::control::ControlParams {
            frost_c: self.frost_c,
            hysteresis_below_c: self.hysteresis_below_c,
            hysteresis_above_c: self.hysteresis_above_c,
            min_cycle: chrono::Duration::seconds(self.min_cycle_s as i64),
            setpoint_jump_c: self.setpoint_jump_c,
            stale_after: chrono::Duration::seconds(self.stale_after_s as i64),
        }
    }
}

/// The heatlink (`[heatlink]`): its Thing name and the parameters sent with
/// `demand` and `set_schedule`.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct HeatlinkConfig {
    /// Thing name; topics are `nakostat/{thing}/…`.
    pub thing: String,
    /// POSIX TZ string for the heatlink's fallback schedule.
    pub tz: String,
    /// Fallback heats while the scheduled target is at least this.
    pub comfort_c: f32,
    /// Fallback duty cycle, percent of each hour.
    pub duty_pct: u8,
    /// `ttl_s` sent with each demand (the heatlink clamps to 60–1800).
    pub demand_ttl_s: u32,
    /// How often `set_schedule` is re-sent.
    pub schedule_push_interval_s: u64,
}

impl Default for HeatlinkConfig {
    fn default() -> Self {
        Self {
            thing: "nakostat-heatlink".to_string(),
            tz: "GMT0BST,M3.5.0/1,M10.5.0".to_string(),
            comfort_c: 18.0,
            duty_pct: 67,
            demand_ttl_s: 300,
            schedule_push_interval_s: 6 * 3600,
        }
    }
}

/// Overwrite `field` from env var `name` if it is set and parses.
fn env_override<T: std::str::FromStr>(name: &str, field: &mut T) {
    if let Ok(v) = std::env::var(name) {
        match v.parse() {
            Ok(parsed) => *field = parsed,
            Err(_) => tracing::warn!("Ignoring unparseable {name}={v:?}"),
        }
    }
}

impl Config {
    pub fn from_file(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("reading config file {}", path.display()))?;
        let mut cfg: Config = toml::from_str(&text)
            .with_context(|| format!("parsing config file {}", path.display()))?;
        cfg.apply_env_overrides();
        Ok(cfg)
    }

    pub fn from_args() -> Result<Self> {
        let path = parse_config_arg().unwrap_or_else(|| PathBuf::from("/etc/nakostat/sensor.toml"));
        Self::from_file(&path)
    }

    fn apply_env_overrides(&mut self) {
        use std::env::var;

        if let Ok(v) = var("NAKOSTAT_MQTT_ENDPOINT") {
            self.mqtt.endpoint = v;
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_PORT") {
            if let Ok(port) = v.parse::<u16>() {
                self.mqtt.port = port;
            }
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_CLIENT_ID") {
            self.mqtt.client_id = v;
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_CERT_PATH") {
            self.mqtt.cert_path = v;
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_KEY_PATH") {
            self.mqtt.key_path = v;
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_TOPIC") {
            self.mqtt.topic = v;
        }
        if let Ok(v) = var("NAKOSTAT_SENSOR_I2C_BUS") {
            if let Ok(bus) = v.parse::<u8>() {
                self.sensor.i2c_bus = bus;
            }
        }
        if let Ok(v) = var("NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S") {
            if let Ok(interval) = v.parse::<u64>() {
                self.sensor.publish_interval_s = interval;
            }
        }
        if let Ok(v) = var("NAKOSTAT_SENSOR_WARMUP_S") {
            if let Ok(warmup) = v.parse::<u64>() {
                self.sensor.warmup_s = warmup;
            }
        }
        if let Ok(v) = var("NAKOSTAT_SOCKET_PATH") {
            self.socket.path = v;
        }
        if let Ok(v) = var("NAKOSTAT_SCHEDULE_PATH") {
            self.schedule.path = v;
        }
        if let Ok(v) = var("NAKOSTAT_MQTT_ENV") {
            self.mqtt.env = Some(v);
        }

        let c = &mut self.control;
        env_override("NAKOSTAT_CONTROL_FROST_C", &mut c.frost_c);
        env_override(
            "NAKOSTAT_CONTROL_HYSTERESIS_BELOW_C",
            &mut c.hysteresis_below_c,
        );
        env_override(
            "NAKOSTAT_CONTROL_HYSTERESIS_ABOVE_C",
            &mut c.hysteresis_above_c,
        );
        env_override("NAKOSTAT_CONTROL_MIN_CYCLE_S", &mut c.min_cycle_s);
        env_override("NAKOSTAT_CONTROL_SETPOINT_JUMP_C", &mut c.setpoint_jump_c);
        env_override("NAKOSTAT_CONTROL_STALE_AFTER_S", &mut c.stale_after_s);
        env_override(
            "NAKOSTAT_CONTROL_DEMAND_INTERVAL_S",
            &mut c.demand_interval_s,
        );
        env_override("NAKOSTAT_CONTROL_STATE_INTERVAL_S", &mut c.state_interval_s);
        env_override("NAKOSTAT_CONTROL_STATE_PATH", &mut c.state_path);
        env_override(
            "NAKOSTAT_CONTROL_ALLOW_MOCK_DEMAND",
            &mut c.allow_mock_demand,
        );

        let h = &mut self.heatlink;
        env_override("NAKOSTAT_HEATLINK_THING", &mut h.thing);
        env_override("NAKOSTAT_HEATLINK_TZ", &mut h.tz);
        env_override("NAKOSTAT_HEATLINK_COMFORT_C", &mut h.comfort_c);
        env_override("NAKOSTAT_HEATLINK_DUTY_PCT", &mut h.duty_pct);
        env_override("NAKOSTAT_HEATLINK_DEMAND_TTL_S", &mut h.demand_ttl_s);
        env_override(
            "NAKOSTAT_HEATLINK_SCHEDULE_PUSH_INTERVAL_S",
            &mut h.schedule_push_interval_s,
        );
    }
}

fn parse_config_arg() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let pos = args.iter().position(|a| a == "--config")?;
    args.get(pos + 1).map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex;

    // Env vars are process-global; serialise all tests that read or write them.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    const VALID_TOML: &str = r#"
[mqtt]
endpoint   = "abc123.iot.eu-west-1.amazonaws.com"
port       = 8883
client_id  = "nakostat-pi-prod"
cert_path  = "/etc/nakostat/pi-cert.pem"
key_path   = "/etc/nakostat/pi-key.pem"
topic      = "nakostat/prod/pi/readings"

[sensor]
i2c_bus            = 1
publish_interval_s = 30
warmup_s           = 180

[socket]
path = "/run/nakostat/sensor.sock"
"#;

    fn write_toml(content: &str) -> (tempfile::NamedTempFile, PathBuf) {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, "{content}").unwrap();
        let path = f.path().to_path_buf();
        (f, path)
    }

    #[test]
    fn parses_valid_toml() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        let cfg = Config::from_file(&path).unwrap();
        assert_eq!(cfg.mqtt.endpoint, "abc123.iot.eu-west-1.amazonaws.com");
        assert_eq!(cfg.mqtt.port, 8883);
        assert_eq!(cfg.mqtt.client_id, "nakostat-pi-prod");
        assert_eq!(cfg.sensor.i2c_bus, 1);
        assert_eq!(cfg.sensor.publish_interval_s, 30);
        assert_eq!(cfg.sensor.warmup_s, 180);
        assert_eq!(cfg.socket.path, "/run/nakostat/sensor.sock");
        assert_eq!(cfg.schedule.path, "/var/lib/nakostat/schedule.json");
    }

    #[test]
    fn schedule_path_from_toml_and_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        let toml = format!("{VALID_TOML}\n[schedule]\npath = \"/tmp/s.json\"\n");
        let (_f, path) = write_toml(&toml);
        assert_eq!(
            Config::from_file(&path).unwrap().schedule.path,
            "/tmp/s.json"
        );
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::set_var("NAKOSTAT_SCHEDULE_PATH", "/tmp/env.json") };
        let cfg = Config::from_file(&path).unwrap();
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::remove_var("NAKOSTAT_SCHEDULE_PATH") };
        assert_eq!(cfg.schedule.path, "/tmp/env.json");
    }

    #[test]
    fn env_var_overrides_mqtt_endpoint() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe {
            std::env::set_var(
                "NAKOSTAT_MQTT_ENDPOINT",
                "override.iot.eu-west-1.amazonaws.com",
            )
        };
        let cfg = Config::from_file(&path).unwrap();
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::remove_var("NAKOSTAT_MQTT_ENDPOINT") };
        assert_eq!(cfg.mqtt.endpoint, "override.iot.eu-west-1.amazonaws.com");
    }

    #[test]
    fn env_var_overrides_publish_interval() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::set_var("NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S", "60") };
        let cfg = Config::from_file(&path).unwrap();
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::remove_var("NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S") };
        assert_eq!(cfg.sensor.publish_interval_s, 60);
    }

    #[test]
    fn env_var_overrides_socket_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::set_var("NAKOSTAT_SOCKET_PATH", "/tmp/test.sock") };
        let cfg = Config::from_file(&path).unwrap();
        // SAFETY: ENV_LOCK serialises every test that touches the environment.
        unsafe { std::env::remove_var("NAKOSTAT_SOCKET_PATH") };
        assert_eq!(cfg.socket.path, "/tmp/test.sock");
    }

    #[test]
    fn control_and_heatlink_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        let cfg = Config::from_file(&path).unwrap();
        let c = &cfg.control;
        assert_eq!(c.frost_c, 7.0);
        assert_eq!(c.hysteresis_below_c, 0.3);
        assert_eq!(c.hysteresis_above_c, 0.2);
        assert_eq!(c.min_cycle_s, 180);
        assert_eq!(c.setpoint_jump_c, 1.0);
        assert_eq!(c.stale_after_s, 300);
        assert_eq!(c.demand_interval_s, 30);
        assert_eq!(c.state_interval_s, 60);
        assert_eq!(c.state_path, "/var/lib/nakostat/control.json");
        assert!(!c.allow_mock_demand);
        let h = &cfg.heatlink;
        assert_eq!(h.thing, "nakostat-heatlink");
        assert_eq!(h.tz, "GMT0BST,M3.5.0/1,M10.5.0");
        assert_eq!(h.comfort_c, 18.0);
        assert_eq!(h.duty_pct, 67);
        assert_eq!(h.demand_ttl_s, 300);
        assert_eq!(h.schedule_push_interval_s, 21600);
        assert_eq!(c.params(), crate::control::ControlParams::default());
    }

    #[test]
    fn control_and_heatlink_from_toml() {
        let _guard = ENV_LOCK.lock().unwrap();
        let toml = format!(
            "{VALID_TOML}\n[control]\nfrost_c = 5.0\nmin_cycle_s = 60\nallow_mock_demand = true\n\n[heatlink]\ncomfort_c = 19.5\nduty_pct = 50\n"
        );
        let (_f, path) = write_toml(&toml);
        let cfg = Config::from_file(&path).unwrap();
        assert_eq!(cfg.control.frost_c, 5.0);
        assert_eq!(cfg.control.min_cycle_s, 60);
        assert!(cfg.control.allow_mock_demand);
        assert_eq!(cfg.control.stale_after_s, 300, "unset keys keep defaults");
        assert_eq!(cfg.heatlink.comfort_c, 19.5);
        assert_eq!(cfg.heatlink.duty_pct, 50);
        assert_eq!(cfg.heatlink.thing, "nakostat-heatlink");
    }

    #[test]
    fn control_and_heatlink_env_overrides() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        let vars = [
            ("NAKOSTAT_CONTROL_FROST_C", "6.5"),
            ("NAKOSTAT_CONTROL_STALE_AFTER_S", "600"),
            ("NAKOSTAT_CONTROL_STATE_PATH", "/tmp/c.json"),
            ("NAKOSTAT_CONTROL_ALLOW_MOCK_DEMAND", "true"),
            ("NAKOSTAT_HEATLINK_DUTY_PCT", "80"),
            ("NAKOSTAT_HEATLINK_THING", "nakostat-heatlink-2"),
            ("NAKOSTAT_HEATLINK_COMFORT_C", "not-a-number"),
            ("NAKOSTAT_MQTT_ENV", "sandbox"),
        ];
        for (k, v) in vars {
            // SAFETY: ENV_LOCK serialises every test that touches the environment.
            unsafe { std::env::set_var(k, v) };
        }
        let cfg = Config::from_file(&path).unwrap();
        for (k, _) in vars {
            // SAFETY: ENV_LOCK serialises every test that touches the environment.
            unsafe { std::env::remove_var(k) };
        }
        assert_eq!(cfg.control.frost_c, 6.5);
        assert_eq!(cfg.control.stale_after_s, 600);
        assert_eq!(cfg.control.state_path, "/tmp/c.json");
        assert!(cfg.control.allow_mock_demand);
        assert_eq!(cfg.heatlink.duty_pct, 80);
        assert_eq!(cfg.heatlink.thing, "nakostat-heatlink-2");
        assert_eq!(cfg.heatlink.comfort_c, 18.0, "unparseable value ignored");
        assert_eq!(cfg.mqtt.env(), "sandbox");
    }

    #[test]
    fn env_derived_from_readings_topic() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        let mut m = Config::from_file(&path).unwrap().mqtt;
        assert_eq!(m.env(), "prod");
        m.topic = "nakostat/sandbox/pi/readings".into();
        assert_eq!(m.env(), "sandbox");
        m.topic = "something/else".into();
        assert_eq!(m.env(), "prod");
        m.env = Some(String::new());
        assert_eq!(m.env(), "prod", "empty env is ignored");
        m.env = Some("sandbox".into());
        assert_eq!(m.env(), "sandbox");
    }

    #[test]
    fn example_config_parses_with_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(include_str!("../config.toml.example"));
        let cfg = Config::from_file(&path).unwrap();
        assert_eq!(cfg.mqtt.env(), "prod");
        assert_eq!(
            cfg.control.params(),
            crate::control::ControlParams::default()
        );
        assert_eq!(cfg.heatlink.duty_pct, 67);
        assert_eq!(cfg.heatlink.tz, "GMT0BST,M3.5.0/1,M10.5.0");
    }

    #[test]
    fn missing_required_field_returns_error() {
        let (_f, path) = write_toml("[mqtt]\nendpoint = \"x\"\n");
        assert!(Config::from_file(&path).is_err());
    }

    #[test]
    fn missing_file_returns_error() {
        assert!(Config::from_file(Path::new("/nonexistent/path/sensor.toml")).is_err());
    }
}
