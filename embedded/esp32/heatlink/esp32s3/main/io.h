// The heatlink's hardware: the relay, the 3-way switch and the WS2812 status LED. GPIOs and the
// relay's polarity come from the board (port/board.h), chosen at boot from the prov partition.
#pragma once

#include <stdbool.h>

#include "board.h"
#include "heatlink.h"
#include "led.h"

// Configures the board's GPIOs with the relay off, and the LED. Call first thing in app_start.
// NULL (a board this image doesn't know) touches no pin: the relay stays off, the switch reads auto
// and there is no LED.
void io_init(const hl_board *board);

// Drives the relay: on or off (as the module's polarity needs).
void io_set_relay(bool on);

// The switch's raw (undebounced) position.
hl_switch io_read_switch(void);

// Shows a colour (at CONFIG_HEATLINK_LED_LEVEL). Writes the LED only when the colour changes.
void io_set_led(hl_led colour);
