// The heatlink's local copy of the heating schedule, and the fallback that runs from it when the
// Pi's demand goes stale. Portable, so the host tests it.
//
// The daemon sends the schedule with set_schedule (hl_cmd.h): seven days, Monday first, each a list
// of transition points [minute_of_day, target_c]. As in the daemon (sensor-daemon schedule.rs), an
// entry holds from its minute until the next entry, and the target in force is the most recent
// entry at-or-before now, searching backwards around the week: early Monday inherits Sunday
// night's last entry, and an empty day holds whatever came before it.
//
// Fallback: heat while the target in force is at least comfort, on a duty cycle of duty_pct of
// each clock hour (67% = minutes 0-39 on, 40-59 off). There is no room temperature at the boiler,
// so it behaves like an old timer-only programmer.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define HL_DAYS 7
#define HL_MAX_ENTRIES 8  // per day
#define HL_MINUTES_PER_DAY 1440
#define HL_TZ_MAX 64  // including the NUL
#define HL_TZ_DEFAULT "GMT0BST,M3.5.0/1,M10.5.0"  // Europe/London

// Limits applied to what set_schedule sends (clamped, not refused). Temperatures in 0.01 degC.
#define HL_TARGET_MIN_CENTI 0     // as the daemon's MIN_TARGET_C
#define HL_TARGET_MAX_CENTI 3000  // and MAX_TARGET_C
#define HL_COMFORT_MIN_CENTI 500  // a comfort of 0 would heat on every entry
#define HL_COMFORT_MAX_CENTI 3000
#define HL_COMFORT_DEFAULT_CENTI 1800
#define HL_DUTY_MAX 100
#define HL_DUTY_DEFAULT 67

typedef struct
{
    uint16_t minute;       // 0..1439, local time
    int16_t target_centi;  // within HL_TARGET_MIN/MAX_CENTI
} hl_entry;

// Kept in NVS as it is, so fixed-size and with no pointers.
typedef struct
{
    uint8_t count[HL_DAYS];  // entries per day, 0..HL_MAX_ENTRIES
    hl_entry entry[HL_DAYS][HL_MAX_ENTRIES];  // each day's sorted by minute, no duplicates
    int16_t comfort_centi;
    uint8_t duty_pct;  // 0..100
    char tz[HL_TZ_MAX];  // a POSIX TZ string, NUL-terminated
} hl_schedule;

// Local wall-clock time: what the schedule is evaluated against.
typedef struct
{
    uint8_t wday;     // 0 = Monday .. 6 = Sunday
    uint16_t minute;  // of the day, 0..1439
} hl_local;

// An empty schedule with the defaults (comfort, duty, Europe/London).
void hl_schedule_init(hl_schedule *s);

// Whether a schedule read back from storage is well formed (counts, order, ranges, tz terminated).
bool hl_schedule_valid(const hl_schedule *s);

// The target in force at `now`, in 0.01 degC. False only if the schedule has no entries at all.
bool hl_schedule_target(const hl_schedule *s, hl_local now, int16_t *target_centi);

// Minutes of each hour the fallback heats: duty_pct of 60, to the nearest minute.
int hl_duty_minutes(uint8_t duty_pct);

// Whether the fallback heats at `now`: the target in force is at least comfort, and the minute of
// the hour is inside the duty cycle.
bool hl_fallback_heat(const hl_schedule *s, hl_local now);
