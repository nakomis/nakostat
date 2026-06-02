mod config;
mod mqtt;
mod schedule;
mod sensor;
mod socket;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use config::Config;
use mqtt::MqttPublisher;
use sensor::SensorReader;
use socket::SocketServer;

#[cfg(feature = "real-sensor")]
use sensor::I2cSensorReader;

#[cfg(not(feature = "real-sensor"))]
use sensor::MockSensorReader;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_args()?;
    info!("nakostat-sensor starting");

    let (mqtt_publisher, _mqtt_handle) = MqttPublisher::new(&cfg.mqtt).await?;
    let mqtt_publisher = Arc::new(mqtt_publisher);

    let (tx, rx) = broadcast::channel::<sensor::SensorReading>(16);

    let socket_path = cfg.socket.path.clone();
    let _socket_handle = tokio::spawn(async move {
        if let Err(e) = SocketServer::run(&socket_path, rx).await {
            error!("Socket server error: {e}");
        }
    });

    #[cfg(feature = "real-sensor")]
    let mut reader: Box<dyn SensorReader> = Box::new(I2cSensorReader::new(cfg.sensor.i2c_bus)?);

    #[cfg(not(feature = "real-sensor"))]
    let mut reader: Box<dyn SensorReader> = Box::new(MockSensorReader::default());

    // Hard-coded heating schedule (STAT-45). Later stories make this stored and
    // editable (STAT-46+); the daemon is the source of truth for the setpoint.
    let schedule = schedule::default_schedule();
    info!("Loaded hard-coded heating schedule");

    let warmup = std::time::Duration::from_secs(cfg.sensor.warmup_s);
    let interval = std::time::Duration::from_secs(cfg.sensor.publish_interval_s);

    info!("Warming up for {}s", warmup.as_secs());
    tokio::time::sleep(warmup).await;

    let mut ticker = tokio::time::interval(interval);
    loop {
        ticker.tick().await;

        let reading = match reader.read() {
            Ok(r) => r,
            Err(e) => {
                warn!("Sensor read error: {e}");
                continue;
            }
        };

        // Evaluate the heating schedule against the local wall clock (STAT-45).
        // The setpoint produced here is what the control loop will act on.
        // TODO(STAT-51): feed this into the hysteresis control loop to drive the
        // relay; the comparison below is indicative logging only (no hysteresis).
        if let Some(setpoint) = schedule.current_setpoint(chrono::Local::now()) {
            let heat = if reading.temperature_c < setpoint { "ON" } else { "off" };
            info!(
                "Schedule setpoint {setpoint:.1}°C, measured {:.1}°C → heat {heat}",
                reading.temperature_c
            );
        }

        if let Err(e) = mqtt_publisher.publish(&reading) {
            warn!("MQTT publish error: {e}");
        }

        // Broadcast to socket clients; ignore if no listeners
        let _ = tx.send(reading);
    }

    #[allow(unreachable_code)]
    {
        _socket_handle.abort();
        _mqtt_handle.abort();
        Ok(())
    }
}
