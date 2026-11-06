// The boards and their pins. See board.h.
#include "board.h"

#include <stddef.h>
#include <string.h>

static const hl_board BOARDS[] = {
    // The DevKitC-1's onboard LED moved from GPIO 48 (v1.0) to 38 (v1.1).
    {.name = "devkitc", .relay = 4, .relay_active_low = true, .sw_on = 5, .sw_off = 6, .led = 48},
    {.name = "devkitc-v1.1", .relay = 4, .relay_active_low = true, .sw_on = 5, .sw_off = 6, .led = 38},
    // A low-side FET with a 100k gate pull-down; 10k pull-ups on the throws.
    {.name = "pcb-v1", .relay = 12, .relay_active_low = false, .sw_on = 13, .sw_off = 14, .led = 15},
};

#define N_BOARDS ((int)(sizeof(BOARDS) / sizeof(BOARDS[0])))

const hl_board *hl_board_find(const char *name)
{
    if (name == NULL || *name == '\0')
        name = HL_BOARD_DEFAULT;
    for (int i = 0; i < N_BOARDS; i++)
        if (strcmp(BOARDS[i].name, name) == 0)
            return &BOARDS[i];
    return NULL;
}

const hl_board *hl_board_at(int i)
{
    return i >= 0 && i < N_BOARDS ? &BOARDS[i] : NULL;
}
