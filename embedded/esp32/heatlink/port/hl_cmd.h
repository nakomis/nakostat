// The heatlink's own commands, as they arrive on nakostat/<thing>/commands:
//
//   {"command":"demand","on":true,"source":"schedule"|"override"|"frost"|"off",
//    "setpoint":20.5,"temperature":19.8,"ttl_s":300,"ts":1760000000}
//       on is required. source defaults to "override" (a hand-sent demand); ttl_s defaults to 300
//       and is clamped to 60..1800; setpoint and temperature are optional and informational. ts,
//       optional, is the daemon's Unix time in seconds when it sent the demand (see
//       hl_demand_too_old in heatlink.h).
//   {"command":"set_schedule","enabled":true,"tz":"GMT0BST,M3.5.0/1,M10.5.0","comfort_c":18.0,
//    "duty_pct":67,"days":[[[360,20.0],[540,16.0]], ... seven days, Monday first]}
//       days is required: exactly seven arrays of at most 8 [minute_of_day, target_c] pairs, the
//       minute a whole number 0..1439. Targets are clamped to 0..30 degC, comfort_c (default 18)
//       to 5..30, duty_pct (default 67) to 0..100 and rounded; tz defaults to Europe/London;
//       enabled (default true) is false while the daemon's mode is off.
//       Entries are sorted; two at the same minute keep the later one, as the daemon does.
//   {"command":"get_status"} | {"command":"reboot"}
//
// Fleet's own commands (get_version, ping, ota_update, url_chunk, ota_cancel) come back as
// HL_CMD_FLEET without their arguments being looked at: hand the same bytes to ota_cmd_parse.
// Anything malformed or unknown is HL_CMD_ERROR (an unknown command's message is
// "unknown command"), never a change. Nesting deeper than 8 levels is refused before cJSON parses
// it (cJSON recurses per level on a small task stack); set_schedule needs 4.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "heatlink.h"
#include "schedule.h"

typedef enum
{
    HL_CMD_GET_STATUS,
    HL_CMD_DEMAND,        // on, source, ttl_s (and the optional readings) are set
    HL_CMD_SET_SCHEDULE,  // schedule is set
    HL_CMD_REBOOT,
    HL_CMD_FLEET,         // one of Fleet's commands: pass the bytes to ota_cmd_parse
    HL_CMD_ERROR,         // message is set
} hl_cmd_kind;

typedef struct
{
    hl_cmd_kind kind;
    // demand
    bool on;
    hl_source source;
    uint32_t ttl_s;
    bool has_setpoint, has_temperature;
    int16_t setpoint_centi, temperature_centi;
    bool has_ts;
    int64_t ts;  // Unix seconds, when has_ts
    // set_schedule
    hl_schedule schedule;
    char message[96];
} hl_cmd;

void hl_cmd_parse(const char *json, size_t len, hl_cmd *out);
