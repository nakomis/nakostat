// Host-side stand-in for <Arduino.h>, used only by the `native` test
// environment. Provides just enough for hardware-independent libraries, with
// a controllable clock and a record of the last GPIO writes.
#ifndef NAKOSTAT_FAKE_ARDUINO_H
#define NAKOSTAT_FAKE_ARDUINO_H

#include <stdint.h>

#define LOW 0x0
#define HIGH 0x1
#define INPUT 0x01
#define OUTPUT 0x03

namespace fake_arduino {
inline unsigned long now_ms = 0;
inline int pin_level[64] = {};
inline int pin_mode[64] = {};
inline int write_count = 0;

inline void reset() {
    now_ms = 0;
    write_count = 0;
    for (int i = 0; i < 64; ++i) {
        pin_level[i] = -1;  // never written
        pin_mode[i] = -1;   // never configured
    }
}
}  // namespace fake_arduino

inline unsigned long millis() { return fake_arduino::now_ms; }

inline void pinMode(uint8_t pin, uint8_t mode) { fake_arduino::pin_mode[pin] = mode; }

inline void digitalWrite(uint8_t pin, uint8_t level) {
    fake_arduino::pin_level[pin] = level;
    ++fake_arduino::write_count;
}

#endif
