// The local schedule and its fallback. See schedule.h.
#include "schedule.h"

#include <stdio.h>
#include <string.h>

void hl_schedule_init(hl_schedule *s)
{
    memset(s, 0, sizeof(*s));
    s->comfort_centi = HL_COMFORT_DEFAULT_CENTI;
    s->duty_pct = HL_DUTY_DEFAULT;
    s->enabled = true;
    snprintf(s->tz, sizeof(s->tz), "%s", HL_TZ_DEFAULT);
}

bool hl_schedule_valid(const hl_schedule *s)
{
    if (s == NULL || s->duty_pct > HL_DUTY_MAX || s->comfort_centi < HL_COMFORT_MIN_CENTI ||
        s->comfort_centi > HL_COMFORT_MAX_CENTI || memchr(s->tz, 0, sizeof(s->tz)) == NULL || s->tz[0] == 0)
        return false;
    uint8_t enabled;  // read as a byte: a stored bool that isn't 0 or 1 is corrupt
    memcpy(&enabled, &s->enabled, 1);
    if (enabled > 1)
        return false;
    for (int d = 0; d < HL_DAYS; d++)
    {
        if (s->count[d] > HL_MAX_ENTRIES)
            return false;
        for (int i = 0; i < s->count[d]; i++)
        {
            const hl_entry *e = &s->entry[d][i];
            if (e->minute >= HL_MINUTES_PER_DAY || e->target_centi < HL_TARGET_MIN_CENTI ||
                e->target_centi > HL_TARGET_MAX_CENTI)
                return false;
            if (i > 0 && e->minute <= s->entry[d][i - 1].minute)
                return false;
        }
    }
    return true;
}

bool hl_schedule_target(const hl_schedule *s, hl_local now, int16_t *target_centi)
{
    if (s == NULL || now.wday >= HL_DAYS || now.minute >= HL_MINUTES_PER_DAY)
        return false;
    // Today's entries up to now, latest first; then each earlier day's last entry, back around the
    // week to today again (whose last entry is then the one in force before today's first).
    for (int back = 0; back <= HL_DAYS; back++)
    {
        int d = (now.wday - back + HL_DAYS * 2) % HL_DAYS;
        for (int i = s->count[d] - 1; i >= 0; i--)
        {
            if (back == 0 && s->entry[d][i].minute > now.minute)
                continue;
            *target_centi = s->entry[d][i].target_centi;
            return true;
        }
    }
    return false;
}

int hl_duty_minutes(uint8_t duty_pct)
{
    if (duty_pct > HL_DUTY_MAX)
        duty_pct = HL_DUTY_MAX;
    return (duty_pct * 60 + 50) / 100;
}

bool hl_fallback_heat(const hl_schedule *s, hl_local now)
{
    int16_t target;
    if (!s->enabled || !hl_schedule_target(s, now, &target) || target < s->comfort_centi)
        return false;
    return now.minute % 60 < hl_duty_minutes(s->duty_pct);
}
