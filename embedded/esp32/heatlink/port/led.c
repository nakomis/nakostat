// Status LED colours. See led.h.
#include "led.h"

hl_led hl_led_colour(hl_mode mode, bool relay, bool connected, int64_t now_ms)
{
    hl_led colour;
    if (mode == HL_MODE_FORCE_ON || mode == HL_MODE_FORCE_OFF)
        colour = HL_LED_PURPLE;
    else if (relay)
        colour = HL_LED_ORANGE;
    else if (mode == HL_MODE_FALLBACK)
        colour = HL_LED_BLUE;
    else
        colour = HL_LED_GREEN;
    if (!connected && now_ms >= 0 && (now_ms / HL_LED_BLINK_MS) % 2 == 0)
        return HL_LED_RED;
    return colour;
}

void hl_led_rgb(hl_led colour, uint8_t level, uint8_t *r, uint8_t *g, uint8_t *b)
{
    static const uint8_t rgb[][3] = {
        [HL_LED_GREEN] = {0, 255, 0},    [HL_LED_ORANGE] = {255, 80, 0}, [HL_LED_BLUE] = {0, 0, 255},
        [HL_LED_PURPLE] = {160, 0, 255}, [HL_LED_RED] = {255, 0, 0},
    };
    unsigned i = (unsigned)colour < sizeof(rgb) / sizeof(rgb[0]) ? (unsigned)colour : HL_LED_RED;
    *r = (uint8_t)(rgb[i][0] * level / 255);
    *g = (uint8_t)(rgb[i][1] * level / 255);
    *b = (uint8_t)(rgb[i][2] * level / 255);
}

const char *hl_led_name(hl_led colour)
{
    switch (colour)
    {
    case HL_LED_GREEN:
        return "green";
    case HL_LED_ORANGE:
        return "orange";
    case HL_LED_BLUE:
        return "blue";
    case HL_LED_PURPLE:
        return "purple";
    case HL_LED_RED:
        return "red";
    }
    return "?";
}
