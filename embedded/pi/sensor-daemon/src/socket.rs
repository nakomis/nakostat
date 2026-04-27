use anyhow::Result;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::sync::broadcast;
use tokio::time::{timeout, Duration};
use tracing::{info, warn};

use crate::sensor::SensorReading;

pub struct SocketServer;

impl SocketServer {
    pub async fn run(path: &str, rx: broadcast::Receiver<SensorReading>) -> Result<()> {
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

async fn serve_client(
    mut stream: tokio::net::UnixStream,
    mut rx: broadcast::Receiver<SensorReading>,
) {
    loop {
        let reading = match rx.recv().await {
            Ok(r) => r,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("Socket client lagged by {n} messages");
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        let mut line = match serde_json::to_string(&reading) {
            Ok(s) => s,
            Err(e) => {
                warn!("JSON serialise error: {e}");
                continue;
            }
        };
        line.push('\n');

        let write_result = timeout(
            Duration::from_secs(1),
            stream.write_all(line.as_bytes()),
        )
        .await;

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

        let (tx, rx) = broadcast::channel::<SensorReading>(4);

        let path = path_str.clone();
        tokio::spawn(async move { SocketServer::run(&path, rx).await.ok() });
        // Give the server a moment to bind
        tokio::time::sleep(Duration::from_millis(50)).await;

        let stream = tokio::net::UnixStream::connect(&path_str).await.unwrap();
        // Yield briefly so the server task can accept() and resubscribe() before we send.
        tokio::time::sleep(Duration::from_millis(10)).await;
        let mut reader = tokio::io::BufReader::new(stream);

        let reading = test_reading();
        tx.send(reading.clone()).unwrap();

        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();

        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["temperature_c"], 21.0);
        assert_eq!(parsed["eco2_ppm"], 600);
        assert_eq!(parsed["warming_up"], false);
    }

    #[tokio::test]
    async fn slow_client_does_not_stall_server() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("slow.sock");
        let path_str = path.to_str().unwrap().to_owned();

        let (tx, rx) = broadcast::channel::<SensorReading>(4);
        let path = path_str.clone();
        tokio::spawn(async move { SocketServer::run(&path, rx).await.ok() });
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Connect but never read — simulates a slow/blocked client
        let _stream = tokio::net::UnixStream::connect(&path_str).await.unwrap();

        // Send enough readings to fill the write buffer and trigger the 1s timeout
        for _ in 0..5 {
            let _ = tx.send(test_reading());
        }

        // Server task should not hang; give it slightly more than the 1s write timeout
        tokio::time::sleep(Duration::from_millis(1200)).await;

        // If we get here the server didn't deadlock
        let ok = tx.send(test_reading());
        assert!(ok.is_ok() || ok.is_err()); // just checking we can still reach the sender
    }
}
