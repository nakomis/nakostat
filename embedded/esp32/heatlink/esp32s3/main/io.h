// The heatlink's hardware: the relay, the 3-way switch and the WS2812 status LED. GPIOs and the
// relay's polarity are Kconfig options (Kconfig.projbuild); the defaults are the DevKitC-1 map in
// the README.
#pragma once

#include <stdbool.h>

#include "heatlink.h"
#include "led.h"

// Configures the GPIOs with the relay off, and the LED. Call first thing in app_start.
void io_init(void);

// Drives the relay: on or off (as the module's polarity needs).
void io_set_relay(bool on);

// The switch's raw (undebounced) position.
hl_switch io_read_switch(void);

// Shows a colour (at CONFIG_HEATLINK_LED_LEVEL). Writes the LED only when the colour changes.
void io_set_led(hl_led colour);
