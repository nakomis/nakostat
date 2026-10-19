mod config;
mod control;
mod daemon;
mod messages;
mod mqtt;
mod schedule;
mod sensor;
mod socket;

use anyhow::Result;
use chrono::Utc;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time::{Instant, MissedTickBehavior, interval_at};
use tracing::{error, info, warn};

use config::Config;
use control::{Controller, Persisted};
use daemon::Daemon;
use messages::Topics;
use mqtt::MqttEvent;
use sensor::SensorReader;
use socket::SocketServer;

#[cfg(feature = "real-sensor")]
use sensor::I2cSensorReader;

#[cfg(not(feature = "real-sensor"))]
use sensor::MockSensorReader;

/// `pi/schedule` is re-published hourly (spec).
const PI_SCHEDULE_INTERVAL: Duration = Duration::from_secs(3600);

/// A ticker whose first tick is one `period` from now (the start-up pushes
/// happen on MQTT connect instead).
fn ticker(period: Duration) -> tokio::time::Interval {
    let period = period.max(Duration::from_secs(1));
    let mut t = interval_at(Instant::now() + period, period);
    t.set_missed_tick_behavior(MissedTickBehavior::Delay);
    t
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_args()?;
    let env = cfg.mqtt.env();
    info!("nakostat daemon starting (env {env})");

    let (sink, mut events, mqtt_handle) = mqtt::connect(&cfg.mqtt).await?;

    let (lines_tx, lines_rx) = broadcast::channel::<String>(32);
    let socket_path = cfg.socket.path.clone();
    let socket_handle = tokio::spawn(async move {
        if let Err(e) = SocketServer::run(&socket_path, lines_rx).await {
            error!("Socket server error: {e}");
        }
    });

    #[cfg(feature = "real-sensor")]
    let mut reader: Box<dyn SensorReader> = Box::new(I2cSensorReader::new(cfg.sensor.i2c_bus)?);

    #[cfg(not(feature = "real-sensor"))]
    let mut reader: Box<dyn SensorReader> = Box::new(MockSensorReader::default());

    // The daemon is the source of truth for the schedule, mode and override,
    // persisted locally so they survive reboots and work offline (STAT-46/51).
    let schedule_path = PathBuf::from(&cfg.schedule.path);
    let state_path = PathBuf::from(&cfg.control.state_path);
    let schedule = schedule::load_or_default(&schedule_path);
    let persisted = Persisted::load(&state_path);
    info!(
        "Mode {:?}, override {:?}",
        persisted.mode, persisted.override_
    );

    let controller = Controller::new(cfg.control.params(), chrono::Local, schedule, persisted);
    let mut daemon = Daemon::new(
        controller,
        sink,
        Topics::new(&env, &cfg.mqtt.topic, &cfg.heatlink.thing),
        cfg.heatlink.clone(),
        schedule_path,
        state_path,
        lines_tx,
    );

    // The ENS160's gas readings need a few minutes to settle, so readings are
    // only published after the warm-up — but the AHT21 temperature is good at
    // once, so the control loop uses it from the first read.
    let warmup_until = Instant::now() + Duration::from_secs(cfg.sensor.warmup_s);
    let mut warmed_up = false;
    info!("Warming up for {}s", cfg.sensor.warmup_s);

    let mut sensor_tick =
        tokio::time::interval(Duration::from_secs(cfg.sensor.publish_interval_s.max(1)));
    sensor_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut demand_tick = ticker(Duration::from_secs(cfg.control.demand_interval_s));
    let mut state_tick = ticker(Duration::from_secs(cfg.control.state_interval_s));
    let mut push_tick = ticker(Duration::from_secs(cfg.heatlink.schedule_push_interval_s));
    let mut pi_schedule_tick = ticker(PI_SCHEDULE_INTERVAL);

    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;

    loop {
        tokio::select! {
            _ = sensor_tick.tick() => {
                if !warmed_up && Instant::now() >= warmup_until {
                    info!("Warm-up complete; publishing readings");
                    warmed_up = true;
                    daemon.set_publish_readings(true);
                }
                match reader.read() {
                    Ok(reading) => daemon.on_reading(&reading, Utc::now()),
                    Err(e) => {
                        warn!("Sensor read error: {e}");
                        daemon.refresh(Utc::now());
                    }
                }
            }
            _ = demand_tick.tick() => daemon.demand_tick(Utc::now()),
            _ = state_tick.tick() => daemon.state_tick(Utc::now()),
            _ = push_tick.tick() => daemon.schedule_push_tick(),
            _ = pi_schedule_tick.tick() => daemon.pi_schedule_tick(Utc::now()),
            ev = events.recv() => match ev {
                Some(MqttEvent::Connected) => daemon.on_connected(Utc::now()),
                Some(MqttEvent::Message { topic, payload }) => {
                    daemon.on_message(&topic, &payload, Utc::now());
                }
                None => {
                    error!("MQTT event loop ended");
                    break;
                }
            },
            _ = tokio::signal::ctrl_c() => {
                info!("Interrupted; shutting down");
                break;
            }
            _ = sigterm.recv() => {
                info!("SIGTERM; shutting down");
                break;
            }
        }
    }

    socket_handle.abort();
    mqtt_handle.abort();
    Ok(())
}
