// The /status JSON, built from a read-only view of the heatlink. Portable, so the host tests it.
//
// {"mode":"auto","relay":true,"switch":"auto","source":"schedule","demand_age_s":12,
//  "schedule_known":true,"time_valid":true,"rssi":-61,"uptime_s":3600,"reason":"heartbeat",
//  "version":"0.1.0"}
// demand_age_s and rssi are null when unknown (no demand since boot; not associated). version is
// what Fleet keeps as the device's last status alongside its currentVersion.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "heatlink.h"

typedef enum
{
    HL_REASON_BOOT,
    HL_REASON_HEARTBEAT,
    HL_REASON_CHANGE,
    HL_REASON_REQUEST,
} hl_reason;

typedef struct
{
    hl_mode mode;
    bool relay;
    hl_switch sw;
    hl_source source;
    bool have_demand;
    uint32_t demand_age_s;
    bool schedule_known, time_valid;
    bool have_rssi;
    int rssi;
    uint32_t uptime_s;
    hl_reason reason;
    const char *version;  // NULL prints null; quotes, backslashes and control characters are escaped
} hl_status;

// Returns the length (the buffer is NUL-terminated), or -1 if it doesn't fit.
int hl_status_json(char *out, size_t cap, const hl_status *v);

const char *hl_reason_name(hl_reason reason);
