// hl-time: local time for the schedule (port/hl_time.c) from the command line.
//
//   hl-time <tz> <epoch_s>...   applies tz, then prints "<wday> <minute>" for each epoch (Mon = 0)
//   hl-time --tz-valid <tz>     prints 1 or 0
//   hl-time --valid <epoch_s>   prints 1 or 0 (wall clock set?)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hl_time.h"

int main(int argc, char *argv[])
{
    if (argc == 3 && strcmp(argv[1], "--tz-valid") == 0)
    {
        printf("%d\n", hl_tz_valid(argv[2]));
        return 0;
    }
    if (argc == 3 && strcmp(argv[1], "--valid") == 0)
    {
        printf("%d\n", hl_time_valid(atoll(argv[2])));
        return 0;
    }
    if (argc < 3)
    {
        fprintf(stderr, "usage: see the comment at the top of time_main.c\n");
        return 2;
    }
    hl_tz_apply(argv[1]);
    for (int i = 2; i < argc; i++)
    {
        hl_local l = hl_local_from_epoch(atoll(argv[i]));
        printf("%u %u\n", l.wday, l.minute);
    }
    return 0;
}
