// hl-led: the status LED's colour (port/led.c) from the command line.
//
//   hl-led <mode> <relay 0|1> <connected 0|1> <now_ms>   prints the colour's name
//   hl-led --rgb <green|orange|blue|purple|red> <level>  prints "r g b"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "led.h"

int main(int argc, char *argv[])
{
    if (argc == 4 && strcmp(argv[1], "--rgb") == 0)
    {
        hl_led c = HL_LED_RED;
        for (hl_led i = HL_LED_GREEN; i <= HL_LED_RED; i++)
            if (strcmp(argv[2], hl_led_name(i)) == 0)
                c = i;
        uint8_t r, g, b;
        hl_led_rgb(c, (uint8_t)atoi(argv[3]), &r, &g, &b);
        printf("%u %u %u\n", r, g, b);
        return 0;
    }
    if (argc != 5)
    {
        fprintf(stderr, "usage: see the comment at the top of led_main.c\n");
        return 2;
    }
    hl_mode mode = HL_MODE_AUTO;
    for (hl_mode m = HL_MODE_AUTO; m <= HL_MODE_FORCE_OFF; m++)
        if (strcmp(argv[1], hl_mode_name(m)) == 0)
            mode = m;
    puts(hl_led_name(hl_led_colour(mode, atoi(argv[2]) != 0, atoi(argv[3]) != 0, atoll(argv[4]))));
    return 0;
}
