#include "BoilerController.h"

BoilerController::BoilerController(int relayPin, bool activeLow, unsigned long watchdogMs)
    : _pin(relayPin),
      _activeLow(activeLow),
      _watchdogMs(watchdogMs),
      _isOn(false),
      _watchdogTripped(false),
      _lastCommandMs(0) {}

void BoilerController::begin() {
    // Drive the GPIO to the OFF state before configuring as output, so we
    // never glitch the relay on during boot.
    writeRelay(false);
    pinMode(_pin, OUTPUT);
    writeRelay(false);
    _isOn = false;
    _watchdogTripped = true;  // Cold start = no commands yet = trip watchdog
    _lastCommandMs = 0;
}

void BoilerController::setOn(bool on) {
    _lastCommandMs = millis();
    _watchdogTripped = false;
    if (on != _isOn) {
        _isOn = on;
        writeRelay(on);
    }
}

bool BoilerController::loop() {
    if (_lastCommandMs == 0) {
        // No command ever received. Watchdog already tripped at begin(),
        // nothing to do until a command arrives.
        return false;
    }
    if (_watchdogTripped) {
        return false;
    }
    if (millis() - _lastCommandMs > _watchdogMs) {
        _watchdogTripped = true;
        if (_isOn) {
            _isOn = false;
            writeRelay(false);
        }
        return true;  // Edge: watchdog just tripped this tick
    }
    return false;
}

unsigned long BoilerController::msSinceLastCommand() const {
    if (_lastCommandMs == 0) return 0;
    return millis() - _lastCommandMs;
}

void BoilerController::writeRelay(bool on) {
    const int level = (on != _activeLow) ? HIGH : LOW;
    digitalWrite(_pin, level);
}
