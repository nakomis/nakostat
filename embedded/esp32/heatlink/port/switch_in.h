// The 3-way switch (on / auto / off): two throws to GND on pulled-up GPIOs, the centre position
// touching neither. Polled every HL_SWITCH_POLL_MS and debounced: a new position counts once it
// has read the same for HL_DEBOUNCE_MS. Portable, so the host tests it.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "heatlink.h"

#define HL_SWITCH_POLL_MS 20
#define HL_DEBOUNCE_MS 50

// Raw position from the two throws (true = pulled low = selected). Both low cannot happen with a
// working centre-off switch; it reads as off, the safe side.
hl_switch hl_switch_from_pins(bool on_low, bool off_low);

typedef struct
{
    bool started;
    hl_switch stable;     // the debounced position
    hl_switch candidate;  // the latest raw reading
    int64_t since_ms;     // when the candidate was first read
} hl_debounce;

// Feeds one raw reading taken at now_ms (a monotonic clock). The first reading is taken as it is,
// so the switch is honoured from boot. Returns whether the debounced position changed.
bool hl_debounce_update(hl_debounce *d, hl_switch raw, int64_t now_ms);
