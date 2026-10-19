//! MQTT link state (STAT-51 review): whether publishing is worth it, and when
//! to (re)subscribe. Pure and clock-injected, so the outage handling is tested
//! without a broker.
//!
//! ```text
//!   Disconnected ──ConnAck──▶ Subscribing ──SubAck ok──▶ Ready
//!        ▲                      │  ▲  │                    │
//!        └──── error/disconnect ┘  └──┘ no SubAck within   │
//!        └──────────────────────────────── retry_after ────┘
//! ```
//!
//! - **Disconnected**: nothing is published. rumqttc would otherwise queue
//!   every request in its channel (64 deep) while it reconnects and replay the
//!   backlog — stale demands first — once the link is back; when the channel
//!   fills, `try_subscribe` fails and the daemon would never resubscribe.
//! - **Subscribing**: connected; the subscription request is out and is sent
//!   again every `retry_after` until a successful SubAck arrives (a failed
//!   enqueue or a refused filter also lands here). Periodic publishes go out.
//! - **Ready**: subscribed. Entering Ready is the moment to push everything
//!   the other side may have missed (set_schedule, demand, state).

use chrono::{DateTime, Duration, Utc};

/// How long to wait for a SubAck before subscribing again.
pub const SUBSCRIBE_RETRY: Duration = Duration::seconds(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Disconnected,
    /// `sent` is when the subscription was last requested (`None`: not yet).
    Subscribing {
        sent: Option<DateTime<Utc>>,
    },
    Ready,
}

#[derive(Debug, Clone)]
pub struct Link {
    phase: Phase,
    retry_after: Duration,
}

impl Default for Link {
    fn default() -> Self {
        Self::new(SUBSCRIBE_RETRY)
    }
}

impl Link {
    pub fn new(retry_after: Duration) -> Self {
        Self {
            phase: Phase::Disconnected,
            retry_after,
        }
    }

    #[cfg(test)]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// True while the broker connection is up, so publishing is worth it.
    pub fn connected(&self) -> bool {
        self.phase != Phase::Disconnected
    }

    /// A ConnAck: a fresh session, so subscriptions must be made again.
    pub fn on_connack(&mut self) {
        self.phase = Phase::Subscribing { sent: None };
    }

    /// The event loop reported an error or a Disconnect. Returns true if the
    /// link was up (so the caller logs the transition once).
    pub fn on_disconnect(&mut self) -> bool {
        let was = self.connected();
        self.phase = Phase::Disconnected;
        was
    }

    /// True if the subscription request should be (re)sent at `now`.
    pub fn should_subscribe(&self, now: DateTime<Utc>) -> bool {
        match self.phase {
            Phase::Subscribing { sent: None } => true,
            Phase::Subscribing { sent: Some(at) } => now - at >= self.retry_after,
            _ => false,
        }
    }

    /// The subscription request was handed to the client (or failed to be;
    /// either way the next attempt is `retry_after` from now).
    pub fn subscribe_attempted(&mut self, now: DateTime<Utc>) {
        if let Phase::Subscribing { .. } = self.phase {
            self.phase = Phase::Subscribing { sent: Some(now) };
        }
    }

    /// A SubAck. `ok` is false if the broker refused any filter, which is
    /// retried like a lost SubAck. Returns true exactly when the link has just
    /// become Ready (so the caller pushes everything).
    pub fn on_suback(&mut self, ok: bool, now: DateTime<Utc>) -> bool {
        match (self.phase, ok) {
            (Phase::Subscribing { .. }, true) => {
                self.phase = Phase::Ready;
                true
            }
            (Phase::Subscribing { .. }, false) => {
                self.phase = Phase::Subscribing { sent: Some(now) };
                false
            }
            // A late or duplicate SubAck while Ready or Disconnected.
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 19, 10, 0, s).unwrap()
    }

    #[test]
    fn starts_disconnected_and_does_not_subscribe() {
        let l = Link::default();
        assert_eq!(l.phase(), Phase::Disconnected);
        assert!(!l.connected());
        assert!(!l.should_subscribe(at(0)));
    }

    #[test]
    fn connack_then_suback_becomes_ready_once() {
        let mut l = Link::default();
        l.on_connack();
        assert!(l.connected());
        assert!(l.should_subscribe(at(0)));
        l.subscribe_attempted(at(0));
        assert!(!l.should_subscribe(at(1)));
        assert!(l.on_suback(true, at(1)));
        assert_eq!(l.phase(), Phase::Ready);
        assert!(!l.should_subscribe(at(30)));
        assert!(
            !l.on_suback(true, at(2)),
            "a duplicate SubAck is not a new Ready"
        );
    }

    #[test]
    fn lost_suback_is_retried_after_interval() {
        let mut l = Link::default();
        l.on_connack();
        l.subscribe_attempted(at(0));
        assert!(!l.should_subscribe(at(9)));
        assert!(l.should_subscribe(at(10)));
        l.subscribe_attempted(at(10));
        assert!(!l.should_subscribe(at(15)));
        assert!(l.should_subscribe(at(20)));
    }

    #[test]
    fn refused_suback_is_retried_later() {
        let mut l = Link::default();
        l.on_connack();
        l.subscribe_attempted(at(0));
        assert!(!l.on_suback(false, at(2)));
        assert_eq!(l.phase(), Phase::Subscribing { sent: Some(at(2)) });
        assert!(!l.should_subscribe(at(11)));
        assert!(l.should_subscribe(at(12)));
    }

    #[test]
    fn disconnect_from_any_phase_stops_publishing() {
        let mut l = Link::default();
        assert!(!l.on_disconnect(), "already down");
        l.on_connack();
        assert!(l.on_disconnect());
        assert!(!l.connected());
        l.on_connack();
        l.on_suback(true, at(0));
        assert!(l.on_disconnect());
        assert!(!l.should_subscribe(at(30)));
        // A stray SubAck after the drop doesn't revive the link.
        assert!(!l.on_suback(true, at(31)));
        assert!(!l.connected());
        // Nor does an attempt being recorded.
        l.subscribe_attempted(at(32));
        assert_eq!(l.phase(), Phase::Disconnected);
    }

    #[test]
    fn reconnect_resubscribes() {
        let mut l = Link::default();
        l.on_connack();
        l.subscribe_attempted(at(0));
        l.on_suback(true, at(1));
        l.on_disconnect();
        l.on_connack();
        assert!(l.should_subscribe(at(2)));
    }
}
