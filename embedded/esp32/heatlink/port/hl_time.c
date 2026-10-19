// Local time for the schedule. See hl_time.h.
#define _POSIX_C_SOURCE 200809L
#include "hl_time.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

bool hl_tz_valid(const char *tz)
{
    if (tz == NULL)
        return false;
    size_t len = strlen(tz);
    if (len == 0 || len >= HL_TZ_MAX)
        return false;
    for (const char *p = tz; *p; p++)
    {
        char c = *p;
        bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || strchr(",.+-/:<>", c);
        if (!ok)
            return false;
    }
    return true;
}

void hl_tz_apply(const char *tz)
{
    setenv("TZ", hl_tz_valid(tz) ? tz : HL_TZ_DEFAULT, 1);
    tzset();
}

bool hl_time_valid(int64_t epoch_s)
{
    return epoch_s >= HL_TIME_VALID_AFTER;
}

hl_local hl_local_from_epoch(int64_t epoch_s)
{
    time_t t = (time_t)epoch_s;
    struct tm tm;
    hl_local local = {0, 0};
    if (localtime_r(&t, &tm) == NULL)
        return local;
    local.wday = (uint8_t)((tm.tm_wday + 6) % 7);  // tm: Sunday = 0; ours: Monday = 0
    local.minute = (uint16_t)(tm.tm_hour * 60 + tm.tm_min);
    return local;
}
