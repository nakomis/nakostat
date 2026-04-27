use anyhow::{Context, Result};
use rumqttc::{AsyncClient, MqttOptions, QoS, Transport};
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::debug;

use crate::config::MqttConfig;
use crate::sensor::SensorReading;

// ── Abstraction layer for testability ────────────────────────────────────────

pub trait MqttSink: Send + Sync + 'static {
    fn publish(&self, topic: &str, payload: &str) -> Result<()>;
}

// ── Production sink (rumqttc AsyncClient) ────────────────────────────────────

struct RumqttcSink {
    client: AsyncClient,
    topic: String,
    runtime: Arc<tokio::runtime::Handle>,
}

impl MqttSink for RumqttcSink {
    fn publish(&self, _topic: &str, payload: &str) -> Result<()> {
        self.runtime.block_on(
            self.client.publish(&self.topic, QoS::AtLeastOnce, false, payload.as_bytes()),
        )?;
        Ok(())
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub struct MqttPublisher {
    sink: Arc<dyn MqttSink>,
    topic: String,
}

impl MqttPublisher {
    /// Connect to AWS IoT Core using mutual TLS. Returns the publisher and a
    /// background task that drives the rumqttc event loop.
    pub async fn new(cfg: &MqttConfig) -> Result<(Self, JoinHandle<()>)> {
        use rustls::pki_types::CertificateDer;
        use rustls::{ClientConfig, RootCertStore};
        use std::fs;
        use std::sync::Arc as RustlsArc;

        // Load device cert and key
        let cert_pem = fs::read(&cfg.cert_path)
            .with_context(|| format!("reading cert {}", cfg.cert_path))?;
        let key_pem = fs::read(&cfg.key_path)
            .with_context(|| format!("reading key {}", cfg.key_path))?;

        let certs: Vec<CertificateDer<'static>> =
            rustls_pemfile::certs(&mut cert_pem.as_slice())
                .collect::<std::result::Result<_, _>>()
                .context("parsing device cert PEM")?;

        let key = rustls_pemfile::private_key(&mut key_pem.as_slice())
            .context("reading device key PEM")?
            .context("no private key found in key file")?;

        // Build root cert store from bundled Mozilla/webpki roots (includes Amazon CAs)
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let tls_config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_client_auth_cert(certs, key)
            .context("building TLS client config")?;

        let mut opts = MqttOptions::new(&cfg.client_id, &cfg.endpoint, cfg.port);
        opts.set_keep_alive(std::time::Duration::from_secs(30));
        opts.set_transport(Transport::tls_with_config(
            rumqttc::TlsConfiguration::Rustls(RustlsArc::new(tls_config)),
        ));

        let (client, mut eventloop) = AsyncClient::new(opts, 16);

        let handle = tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(_) => {}
                    Err(e) => {
                        tracing::warn!("MQTT event loop error: {e}");
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });

        let sink = Arc::new(RumqttcSink {
            client,
            topic: cfg.topic.clone(),
            runtime: Arc::new(tokio::runtime::Handle::current()),
        });

        Ok((
            Self { sink, topic: cfg.topic.clone() },
            handle,
        ))
    }

    /// Create a publisher backed by a custom sink — used in tests.
    pub fn with_sink(sink: Arc<dyn MqttSink>, topic: impl Into<String>) -> Self {
        Self { sink, topic: topic.into() }
    }

    pub fn publish(&self, reading: &SensorReading) -> Result<()> {
        let payload = serde_json::to_string(reading).context("serialising sensor reading")?;
        debug!(topic = %self.topic, payload = %payload, "publishing MQTT");
        self.sink.publish(&self.topic, &payload)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::sync::Mutex;

    struct CaptureSink {
        calls: Mutex<Vec<(String, String)>>,
    }

    impl CaptureSink {
        fn new() -> Arc<Self> {
            Arc::new(Self { calls: Mutex::new(vec![]) })
        }
        fn calls(&self) -> Vec<(String, String)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl MqttSink for CaptureSink {
        fn publish(&self, topic: &str, payload: &str) -> Result<()> {
            self.calls.lock().unwrap().push((topic.to_owned(), payload.to_owned()));
            Ok(())
        }
    }

    fn test_reading() -> SensorReading {
        crate::sensor::SensorReading {
            temperature_c: 22.5,
            humidity_pct: 45.0,
            eco2_ppm: 800,
            tvoc_ppb: 150,
            warming_up: false,
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn publish_calls_sink_with_correct_topic() {
        let sink = CaptureSink::new();
        let publisher = MqttPublisher::with_sink(sink.clone(), "nakostat/test/pi/readings");
        publisher.publish(&test_reading()).unwrap();

        let calls = sink.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "nakostat/test/pi/readings");
    }

    #[test]
    fn publish_payload_contains_all_fields() {
        let sink = CaptureSink::new();
        let publisher = MqttPublisher::with_sink(sink.clone(), "nakostat/test/pi/readings");
        publisher.publish(&test_reading()).unwrap();

        let payload: serde_json::Value = serde_json::from_str(&sink.calls()[0].1).unwrap();
        assert!(payload.get("temperature_c").is_some());
        assert!(payload.get("humidity_pct").is_some());
        assert!(payload.get("eco2_ppm").is_some());
        assert!(payload.get("tvoc_ppb").is_some());
        assert!(payload.get("warming_up").is_some());
        assert!(payload.get("timestamp").is_some());
        assert_eq!(payload["temperature_c"], 22.5);
        assert_eq!(payload["eco2_ppm"], 800);
    }

    #[test]
    fn publish_warming_up_flag_is_serialised() {
        let sink = CaptureSink::new();
        let publisher = MqttPublisher::with_sink(sink.clone(), "t");
        let mut reading = test_reading();
        reading.warming_up = true;
        publisher.publish(&reading).unwrap();
        let payload: serde_json::Value = serde_json::from_str(&sink.calls()[0].1).unwrap();
        assert_eq!(payload["warming_up"], true);
    }
}
