// The boards one image runs on, and their pins. Portable, so the host tests it.
//
// Each heatlink's board is a `board` key in its prov partition (scripts/provision-device.sh), read at
// boot before any GPIO is touched. Every board runs the same published image, so Fleet can never
// send one the wrong image's pins.
//
//   devkitc       the STAT-69 prototype: ESP32-S3-DevKitC-1 v1.0 and a relay module (active-low)
//   devkitc-v1.1  the same on a v1.1 DevKitC, whose LED is on another pin
//   pcb-v1        the STAT-75 board (pcb/heatlink): pins as its generated pins.h; tests/test_board.py
//                 checks they agree
//
// A heatlink provisioned before the key existed has none: that is the DevKitC.
#pragma once

#include <stdbool.h>

typedef struct
{
    const char *name;
    int relay;
    // Active-low is driven open-drain (low = on, released = off through the module's pull-up);
    // active-high push-pull (high = on). Either way the relay is off while the pin floats.
    bool relay_active_low;
    int sw_on, sw_off;  // the switch's throws: internal pull-ups, common to GND
    int led;            // WS2812
} hl_board;

#define HL_BOARD_DEFAULT "devkitc"

// The board called `name`; NULL or "" is HL_BOARD_DEFAULT. NULL for an unknown name.
const hl_board *hl_board_find(const char *name);

// The known boards, in order; NULL past the last.
const hl_board *hl_board_at(int i);
