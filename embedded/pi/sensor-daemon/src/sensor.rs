use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorReading {
    pub temperature_c: f32,
    pub humidity_pct: f32,
    pub eco2_ppm: u16,
    pub tvoc_ppb: u16,
    /// True while the ENS160 is still warming up (~3 min from cold start)
    pub warming_up: bool,
    pub timestamp: DateTime<Utc>,
}

pub trait SensorReader: Send + 'static {
    fn read(&mut self) -> Result<SensorReading>;
}

// ── Mock (used in tests) ──────────────────────────────────────────────────────

#[cfg_attr(feature = "real-sensor", allow(dead_code))]
pub struct MockSensorReader {
    pub temperature_c: f32,
    pub humidity_pct: f32,
    pub eco2_ppm: u16,
    pub tvoc_ppb: u16,
    pub warming_up: bool,
}

impl Default for MockSensorReader {
    fn default() -> Self {
        Self {
            temperature_c: 21.0,
            humidity_pct: 50.0,
            eco2_ppm: 600,
            tvoc_ppb: 100,
            warming_up: false,
        }
    }
}

impl SensorReader for MockSensorReader {
    fn read(&mut self) -> Result<SensorReading> {
        Ok(SensorReading {
            temperature_c: self.temperature_c,
            humidity_pct: self.humidity_pct,
            eco2_ppm: self.eco2_ppm,
            tvoc_ppb: self.tvoc_ppb,
            warming_up: self.warming_up,
            timestamp: Utc::now(),
        })
    }
}

// ── Real I²C implementation (Pi only) ────────────────────────────────────────

/// ENS160 I²C address with ADDR pulled high (the usual breakout default).
#[cfg(feature = "real-sensor")]
const ENS160_ADDRESS: u8 = 0x53;

/// AHT21 I²C address (fixed; the part is AHT20-compatible).
#[cfg(feature = "real-sensor")]
const AHT21_ADDRESS: u8 = 0x38;

#[cfg(feature = "real-sensor")]
pub struct I2cSensorReader {
    ens: ens160::Ens160<linux_embedded_hal::I2cdev>,
    aht: aht20_driver::AHT20<linux_embedded_hal::I2cdev>,
}

#[cfg(feature = "real-sensor")]
impl I2cSensorReader {
    /// Open the I²C bus (e.g. `/dev/i2c-1`) and initialise both sensors.
    pub fn new(bus_number: u8) -> Result<Self> {
        use linux_embedded_hal::{Delay, I2cdev};

        let bus_path = format!("/dev/i2c-{bus_number}");

        // ENS160: switch to standard gas-sensing mode
        let i2c_ens = I2cdev::new(&bus_path)?;
        let mut ens = ens160::Ens160::new(i2c_ens, ENS160_ADDRESS);
        ens.operational()?;

        // AHT21: wait for the sensor to report itself calibrated
        let i2c_aht = I2cdev::new(&bus_path)?;
        let mut delay = Delay;
        let mut aht = aht20_driver::AHT20::new(i2c_aht, AHT21_ADDRESS);
        aht.init(&mut delay)?;

        Ok(Self { ens, aht })
    }
}

#[cfg(feature = "real-sensor")]
impl SensorReader for I2cSensorReader {
    fn read(&mut self) -> Result<SensorReading> {
        use linux_embedded_hal::Delay;

        // AHT21 read — temperature and humidity. The driver hands out a
        // short-lived "initialised" handle; re-acquiring it is cheap once the
        // sensor is calibrated (a status check, no re-initialisation).
        let mut delay = Delay;
        let aht_reading = self.aht.init(&mut delay)?.measure(&mut delay)?;

        let temperature_c = aht_reading.temperature;
        let humidity_pct = aht_reading.humidity;

        // Feed T/RH compensation into ENS160 for more accurate gas readings.
        // The driver takes hundredths of a °C and of a %RH.
        self.ens.set_temp((temperature_c * 100.0) as i16)?;
        self.ens.set_hum((humidity_pct * 100.0) as u16)?;

        let status = self.ens.status()?;
        let warming_up = !matches!(status.validity_flag(), ens160::Validity::NormalOperation);

        let eco2 = self.ens.eco2()?;
        let tvoc = self.ens.tvoc()?;

        Ok(SensorReading {
            temperature_c,
            humidity_pct,
            eco2_ppm: *eco2,
            tvoc_ppb: tvoc,
            warming_up,
            timestamp: Utc::now(),
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_returns_configured_values() {
        let mut reader = MockSensorReader {
            temperature_c: 22.5,
            humidity_pct: 45.0,
            eco2_ppm: 800,
            tvoc_ppb: 150,
            warming_up: true,
        };

        let reading = reader.read().unwrap();
        assert_eq!(reading.temperature_c, 22.5);
        assert_eq!(reading.humidity_pct, 45.0);
        assert_eq!(reading.eco2_ppm, 800);
        assert_eq!(reading.tvoc_ppb, 150);
        assert!(reading.warming_up);
    }

    #[test]
    fn mock_default_is_not_warming_up() {
        let mut reader = MockSensorReader::default();
        let reading = reader.read().unwrap();
        assert!(!reading.warming_up);
    }

    #[test]
    fn reading_serialises_to_expected_json_keys() {
        let mut reader = MockSensorReader::default();
        let reading = reader.read().unwrap();
        let json = serde_json::to_string(&reading).unwrap();
        assert!(json.contains("\"temperature_c\""));
        assert!(json.contains("\"humidity_pct\""));
        assert!(json.contains("\"eco2_ppm\""));
        assert!(json.contains("\"tvoc_ppb\""));
        assert!(json.contains("\"warming_up\""));
        assert!(json.contains("\"timestamp\""));
    }
}
