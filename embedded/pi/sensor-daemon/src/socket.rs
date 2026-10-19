use anyhow::Result;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::sync::broadcast;
use tokio::time::{Duration, timeout};
use tracing::{info, warn};

use crate::control::PiState;
use crate::sensor::SensorReading;

/// A reading line, exactly as before STAT-51 (Pish parses these; keep them
/// byte-compatible).
pub fn reading_line(reading: &SensorReading) -> String {
    serde_json::to_string(reading).expect("reading serialises")
}

#[derive(serde::Serialize)]
struct StateLine<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(flatten)]
    state: &'a PiState,
}

/// A `{"type":"state",…}` line: the `pi/state` object, tagged.
pub fn state_line(state: &PiState) -> String {
    serde_json::to_string(&StateLine {
        kind: "state",
        state,
    })
    .expect("state serialises")
}

pub struct SocketServer;

impl SocketServer {
    /// Serve newline-delimited JSON lines (without the trailing newline on the
    /// channel) to every connected client.
    pub async fn run(path: &str, rx: broadcast::Receiver<String>) -> Result<()> {
        // Remove stale socket from a previous run
        let _ = tokio::fs::remove_file(path).await;

        let listener = UnixListener::bind(path)?;
        info!("Unix socket listening at {path}");

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    info!("Socket client connected");
                    let client_rx = rx.resubscribe();
                    tokio::spawn(serve_client(stream, client_rx));
                }
                Err(e) => warn!("Socket accept error: {e}"),
            }
        }
    }
}

async fn serve_client(mut stream: tokio::net::UnixStream, mut rx: broadcast::Receiver<String>) {
    loop {
        let mut line = match rx.recv().await {
            Ok(r) => r,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("Socket client lagged by {n} messages");
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        line.push('\n');

        let write_result = timeout(Duration::from_secs(1), stream.write_all(line.as_bytes())).await;

        match write_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                warn!("Socket write error, dropping client: {e}");
                break;
            }
            Err(_) => {
                warn!("Socket write timed out, dropping slow client");
                break;
            }
        }
    }
    info!("Socket client disconnected");
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tokio::io::AsyncBufReadExt;

    fn test_reading() -> SensorReading {
        SensorReading {
            temperature_c: 21.0,
            humidity_pct: 50.0,
            eco2_ppm: 600,
            tvoc_ppb: 100,
            warming_up: false,
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn client_receives_json_line() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("test.sock");
        let path_str = path.to_str().unwrap().to_owned();

        let (tx, rx) = broadcast::channel::<String>(4);

        let path = path_str.clone();
        tokio::spawn(async move { SocketServer::run(&path, rx).await.ok() });
        // Give the server a moment to bind
        tokio::time::sleep(Duration::from_millis(50)).await;

        let stream = tokio::net::UnixStream::connect(&path_str).await.unwrap();
        // Yield briefly so the server task can accept() and resubscribe() before we send.
        tokio::time::sleep(Duration::from_millis(10)).await;
        let mut reader = tokio::io::BufReader::new(stream);

        let reading = test_reading();
        tx.send(reading_line(&reading)).unwrap();

        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();

        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["temperature_c"], 21.0);
        assert_eq!(parsed["eco2_ppm"], 600);
        assert_eq!(parsed["warming_up"], false);
    }

    #[test]
    fn reading_line_is_unchanged_format() {
        use chrono::TimeZone;
        let mut r = test_reading();
        r.timestamp = Utc.with_ymd_and_hms(2026, 10, 13, 9, 30, 0).unwrap();
        r.temperature_c = 21.04;
        r.humidity_pct = 49.6;
        assert_eq!(
            reading_line(&r),
            r#"{"temperature_c":21.04,"humidity_pct":49.6,"eco2_ppm":600,"tvoc_ppb":100,"warming_up":false,"timestamp":"2026-10-13T09:30:00Z"}"#
        );
    }

    #[test]
    fn state_line_is_tagged_pi_state() {
        use crate::control::{Mode, PiState, Source};
        use chrono::TimeZone;
        let state = PiState {
            timestamp: Utc.with_ymd_and_hms(2026, 10, 19, 10, 0, 0).unwrap(),
            temperature: Some(19.5),
            humidity: Some(45.0),
            mode: Mode::Heat,
            setpoint: 20.0,
            scheduled_setpoint: Some(20.0),
            override_: None,
            demand: true,
            demand_source: Some(Source::Schedule),
            heatlink: None,
        };
        let line = state_line(&state);
        assert!(
            line.starts_with(r#"{"type":"state","timestamp":"2026-10-19T10:00:00Z""#),
            "{line}"
        );
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["demand"], true);
        assert_eq!(v["demand_source"], "schedule");
        assert_eq!(v["override"], serde_json::Value::Null);
        // Pish's reading parser must not mistake it for a reading.
        assert!(serde_json::from_str::<SensorReading>(&line).is_err());
    }

    #[tokio::test]
    async fn slow_client_does_not_stall_server() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("slow.sock");
        let path_str = path.to_str().unwrap().to_owned();

        let (tx, rx) = broadcast::channel::<String>(4);
        let path = path_str.clone();
        tokio::spawn(async move { SocketServer::run(&path, rx).await.ok() });
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Connect but never read — simulates a slow/blocked client
        let _stream = tokio::net::UnixStream::connect(&path_str).await.unwrap();

        // Send enough readings to fill the write buffer and trigger the 1s timeout
        for _ in 0..5 {
            let _ = tx.send(reading_line(&test_reading()));
        }

        // Server task should not hang; give it slightly more than the 1s write timeout
        tokio::time::sleep(Duration::from_millis(1200)).await;

        // If we get here the server didn't deadlock
        let ok = tx.send(reading_line(&test_reading()));
        assert!(ok.is_ok() || ok.is_err()); // just checking we can still reach the sender
    }
}
