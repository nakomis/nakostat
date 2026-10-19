// hl-switch: the switch reading and debounce (port/switch_in.c) from the command line.
//
//   hl-switch --pins <on_low 0|1> <off_low 0|1>   prints the raw position
//   hl-switch                                      lines "<ms> auto|on|off" on stdin: one reading
//                                                  each; prints "<stable> <changed 0|1>" per line
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "switch_in.h"

int main(int argc, char *argv[])
{
    if (argc == 4 && strcmp(argv[1], "--pins") == 0)
    {
        puts(hl_switch_name(hl_switch_from_pins(atoi(argv[2]) != 0, atoi(argv[3]) != 0)));
        return 0;
    }
    hl_debounce d = {0};
    char line[128], pos[16];
    long long ms;
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        if (sscanf(line, "%lld %15s", &ms, pos) != 2)
            continue;
        hl_switch raw = !strcmp(pos, "on") ? HL_SW_ON : !strcmp(pos, "off") ? HL_SW_OFF : HL_SW_AUTO;
        bool changed = hl_debounce_update(&d, raw, (int64_t)ms);
        printf("%s %d\n", hl_switch_name(d.stable), changed);
    }
    return 0;
}
