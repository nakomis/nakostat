// The heatlink's decision: from the switch, the Pi's last demand, the stored schedule and the
// wall clock, what mode it is in and whether the relay is on. Pure, so the host tests it.
//
//   switch  condition                                      mode       relay
//   on      -                                              force_on   on
//   off     -                                              force_off  off
//   auto    demand younger than its ttl                    auto       demand.on
//   auto    no demand yet, within the first ttl after boot auto       off   (cold boot)
//   auto    demand stale, schedule known, time valid       fallback   hl_fallback_heat()
//   auto    demand stale, no schedule or no valid time     fallback   off
//
// The Pi daemon is the brain; this is a switch with a watchdog and a fallback schedule.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "schedule.h"

#define HL_TTL_MIN_S 60
#define HL_TTL_MAX_S 1800
#define HL_TTL_DEFAULT_S 300

typedef enum
{
    HL_SW_AUTO,
    HL_SW_ON,
    HL_SW_OFF,
} hl_switch;

typedef enum
{
    HL_MODE_AUTO,
    HL_MODE_FALLBACK,
    HL_MODE_FORCE_ON,
    HL_MODE_FORCE_OFF,
} hl_mode;

// Why the relay is where it is. The first four come from the daemon's demand and are echoed back.
typedef enum
{
    HL_SRC_SCHEDULE,
    HL_SRC_OVERRIDE,
    HL_SRC_FROST,
    HL_SRC_OFF,
    HL_SRC_FALLBACK,
    HL_SRC_SWITCH,
} hl_source;

// The last demand from the daemon. Times are a monotonic millisecond clock (since boot).
typedef struct
{
    bool have;  // false until the first demand since boot
    bool on;
    hl_source source;
    int64_t received_ms;
    uint32_t ttl_s;  // already clamped to HL_TTL_MIN_S..HL_TTL_MAX_S
} hl_demand;

typedef struct
{
    hl_switch sw;
    hl_demand demand;
    int64_t now_ms;              // the same monotonic clock: since boot
    const hl_schedule *schedule;  // NULL if none has been received (or stored)
    bool time_valid;             // the wall clock has been set (SNTP)
    hl_local local;              // local time; only read when time_valid
} hl_inputs;

typedef struct
{
    hl_mode mode;
    bool relay;
    hl_source source;
} hl_output;

hl_output hl_decide(const hl_inputs *in);

// Clamps a demand's ttl_s to HL_TTL_MIN_S..HL_TTL_MAX_S.
uint32_t hl_ttl_clamp(double ttl_s);

const char *hl_switch_name(hl_switch sw);
const char *hl_mode_name(hl_mode mode);
const char *hl_source_name(hl_source source);
// Only the daemon's four (schedule, override, frost, off). False for anything else.
bool hl_demand_source_parse(const char *name, hl_source *out);
