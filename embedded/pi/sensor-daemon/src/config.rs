use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub mqtt: MqttConfig,
    pub sensor: SensorConfig,
    pub socket: SocketConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MqttConfig {
    pub endpoint: String,
    pub port: u16,
    pub client_id: String,
    pub cert_path: String,
    pub key_path: String,
    pub topic: String,
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
    }

    #[test]
    fn env_var_overrides_mqtt_endpoint() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        std::env::set_var("NAKOSTAT_MQTT_ENDPOINT", "override.iot.eu-west-1.amazonaws.com");
        let cfg = Config::from_file(&path).unwrap();
        std::env::remove_var("NAKOSTAT_MQTT_ENDPOINT");
        assert_eq!(cfg.mqtt.endpoint, "override.iot.eu-west-1.amazonaws.com");
    }

    #[test]
    fn env_var_overrides_publish_interval() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        std::env::set_var("NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S", "60");
        let cfg = Config::from_file(&path).unwrap();
        std::env::remove_var("NAKOSTAT_SENSOR_PUBLISH_INTERVAL_S");
        assert_eq!(cfg.sensor.publish_interval_s, 60);
    }

    #[test]
    fn env_var_overrides_socket_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let (_f, path) = write_toml(VALID_TOML);
        std::env::set_var("NAKOSTAT_SOCKET_PATH", "/tmp/test.sock");
        let cfg = Config::from_file(&path).unwrap();
        std::env::remove_var("NAKOSTAT_SOCKET_PATH");
        assert_eq!(cfg.socket.path, "/tmp/test.sock");
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
