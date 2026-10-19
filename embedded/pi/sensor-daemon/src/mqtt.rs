use anyhow::{Context, Result};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, Transport};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::config::MqttConfig;

// ── Abstraction layer for testability ────────────────────────────────────────

/// Outbound MQTT operations. Non-blocking: messages are queued for the event
/// loop, so this is safe to call from inside the async runtime.
pub trait MqttSink: Send + Sync + 'static {
    fn publish(&self, topic: &str, payload: &str) -> Result<()>;
    fn subscribe(&self, topic: &str) -> Result<()>;
}

/// What the event loop reports back to the daemon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MqttEvent {
    /// A (re)connection was acknowledged: resubscribe and push state.
    Connected,
    Message {
        topic: String,
        payload: String,
    },
}

// ── Production sink (rumqttc AsyncClient) ────────────────────────────────────

struct RumqttcSink {
    client: AsyncClient,
}

impl MqttSink for RumqttcSink {
    fn publish(&self, topic: &str, payload: &str) -> Result<()> {
        debug!(topic, payload, "publishing MQTT");
        self.client
            .try_publish(topic, QoS::AtLeastOnce, false, payload.as_bytes())
            .with_context(|| format!("queueing publish to {topic}"))
    }

    fn subscribe(&self, topic: &str) -> Result<()> {
        self.client
            .try_subscribe(topic, QoS::AtLeastOnce)
            .with_context(|| format!("queueing subscribe to {topic}"))
    }
}

/// Map a rumqttc event to a daemon event, if it is one the daemon cares about.
fn translate(event: Event) -> Option<MqttEvent> {
    match event {
        Event::Incoming(Packet::ConnAck(_)) => Some(MqttEvent::Connected),
        Event::Incoming(Packet::Publish(p)) => Some(MqttEvent::Message {
            topic: p.topic,
            payload: String::from_utf8_lossy(&p.payload).into_owned(),
        }),
        _ => None,
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Connect to AWS IoT Core using mutual TLS. Returns the sink for outbound
/// messages, a channel of inbound events, and the background task that drives
/// the rumqttc event loop (and reconnects).
pub async fn connect(
    cfg: &MqttConfig,
) -> Result<(Arc<dyn MqttSink>, mpsc::Receiver<MqttEvent>, JoinHandle<()>)> {
    use rustls::pki_types::CertificateDer;
    use rustls::{ClientConfig, RootCertStore};
    use std::fs;

    // Load device cert and key
    let cert_pem =
        fs::read(&cfg.cert_path).with_context(|| format!("reading cert {}", cfg.cert_path))?;
    let key_pem =
        fs::read(&cfg.key_path).with_context(|| format!("reading key {}", cfg.key_path))?;

    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut cert_pem.as_slice())
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
        rumqttc::TlsConfiguration::Rustls(Arc::new(tls_config)),
    ));

    let (client, mut eventloop) = AsyncClient::new(opts, 64);
    let (tx, rx) = mpsc::channel(64);

    let handle = tokio::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(event) => {
                    if let Some(ev) = translate(event) {
                        if ev == MqttEvent::Connected {
                            info!("MQTT connected");
                        }
                        if tx.send(ev).await.is_err() {
                            break; // daemon gone
                        }
                    }
                }
                Err(e) => {
                    warn!("MQTT event loop error: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    });

    Ok((Arc::new(RumqttcSink { client }), rx, handle))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Records every publish and subscribe, for daemon tests.
    #[derive(Default)]
    pub struct CaptureSink {
        pub published: Mutex<Vec<(String, String)>>,
        pub subscribed: Mutex<Vec<String>>,
    }

    impl CaptureSink {
        pub fn published(&self) -> Vec<(String, String)> {
            self.published.lock().unwrap().clone()
        }
        pub fn take(&self) -> Vec<(String, String)> {
            std::mem::take(&mut *self.published.lock().unwrap())
        }
    }

    impl MqttSink for CaptureSink {
        fn publish(&self, topic: &str, payload: &str) -> Result<()> {
            self.published
                .lock()
                .unwrap()
                .push((topic.to_owned(), payload.to_owned()));
            Ok(())
        }
        fn subscribe(&self, topic: &str) -> Result<()> {
            self.subscribed.lock().unwrap().push(topic.to_owned());
            Ok(())
        }
    }

    #[test]
    fn translate_connack_and_publish() {
        use rumqttc::{ConnAck, ConnectReturnCode, Publish};
        let ack = Event::Incoming(Packet::ConnAck(ConnAck {
            session_present: false,
            code: ConnectReturnCode::Success,
        }));
        assert_eq!(translate(ack), Some(MqttEvent::Connected));

        let p = Publish::new("a/b", QoS::AtLeastOnce, r#"{"x":1}"#);
        assert_eq!(
            translate(Event::Incoming(Packet::Publish(p))),
            Some(MqttEvent::Message {
                topic: "a/b".into(),
                payload: r#"{"x":1}"#.into()
            })
        );
        assert_eq!(translate(Event::Incoming(Packet::PingResp)), None);
    }

    fn dummy_cfg(cert_path: &str, key_path: &str) -> MqttConfig {
        MqttConfig {
            endpoint: "localhost".to_string(),
            port: 8883,
            client_id: "test".to_string(),
            cert_path: cert_path.to_string(),
            key_path: key_path.to_string(),
            topic: "test/topic".to_string(),
            env: None,
        }
    }

    #[tokio::test]
    async fn connect_errors_on_missing_cert_file() {
        let err = connect(&dummy_cfg("/nonexistent/cert.pem", "/nonexistent/key.pem"))
            .await
            .err()
            .unwrap();
        assert!(
            err.to_string().contains("reading cert"),
            "unexpected: {err}"
        );
    }

    #[tokio::test]
    async fn connect_errors_on_missing_key_file() {
        use std::io::Write;
        let mut cert = tempfile::NamedTempFile::new().unwrap();
        write!(cert, "not a cert").unwrap();
        let err = connect(&dummy_cfg(
            cert.path().to_str().unwrap(),
            "/nonexistent/key.pem",
        ))
        .await
        .err()
        .unwrap();
        assert!(err.to_string().contains("reading key"), "unexpected: {err}");
    }

    #[tokio::test]
    async fn connect_errors_on_no_private_key_in_pem() {
        use std::io::Write;
        let mut cert = tempfile::NamedTempFile::new().unwrap();
        write!(cert, "not a cert").unwrap();
        let mut key = tempfile::NamedTempFile::new().unwrap();
        write!(key, "not a key").unwrap();
        let err = connect(&dummy_cfg(
            cert.path().to_str().unwrap(),
            key.path().to_str().unwrap(),
        ))
        .await
        .err()
        .unwrap();
        assert!(
            err.to_string().contains("no private key found"),
            "unexpected: {err}"
        );
    }
}
