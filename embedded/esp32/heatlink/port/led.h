// The status LED (the DevKitC's WS2812). Portable, so the host tests it.
//
//   purple  forced on or off by the switch
//   orange  relay on (auto or fallback)
//   blue    fallback, relay off
//   green   auto, idle
//   red     blinking (alternating with the colour above) while Wi-Fi or IoT Core is down
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "heatlink.h"

#define HL_LED_BLINK_MS 500

typedef enum
{
    HL_LED_GREEN,
    HL_LED_ORANGE,
    HL_LED_BLUE,
    HL_LED_PURPLE,
    HL_LED_RED,
} hl_led;

// The colour to show at now_ms (a monotonic clock, for the blink).
hl_led hl_led_colour(hl_mode mode, bool relay, bool connected, int64_t now_ms);

// RGB for a colour at full brightness 255; `level` scales it (0..255).
void hl_led_rgb(hl_led colour, uint8_t level, uint8_t *r, uint8_t *g, uint8_t *b);

const char *hl_led_name(hl_led colour);
