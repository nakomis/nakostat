#ifndef BOILER_CONTROLLER_H
#define BOILER_CONTROLLER_H

#include <Arduino.h>

// Drives a relay GPIO with a command-watchdog fail-safe. If no command is
// received within `watchdogMs`, the relay is forced off until a fresh command
// arrives. The Pi-side controller is expected to publish on/off commands at
// a regular interval (e.g. every 10s) so the watchdog stays warm.
class BoilerController {
public:
    BoilerController(int relayPin, bool activeLow, unsigned long watchdogMs);

    // Configure the GPIO. Must be called before setOn() / loop().
    void begin();

    // Apply a command from upstream. Resets the watchdog.
    void setOn(bool on);

    // Call from loop(). Enforces the watchdog. Returns true on the tick the
    // watchdog tripped (caller can log / publish a status update).
    bool loop();

    // Current driven state (what the relay GPIO is currently asserting).
    bool isOn() const { return _isOn; }

    // Whether the watchdog has expired (no command for >watchdogMs).
    bool isWatchdogExpired() const { return _watchdogTripped; }

    // ms since the last setOn() call.
    unsigned long msSinceLastCommand() const;

private:
    void writeRelay(bool on);

    const int _pin;
    const bool _activeLow;
    const unsigned long _watchdogMs;
    bool _isOn;
    bool _watchdogTripped;
    unsigned long _lastCommandMs;
};

#endif
