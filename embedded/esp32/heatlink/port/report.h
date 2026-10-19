// When the heatlink publishes /status, and why. Portable, so the host tests it.
//
// The app task calls hl_report_due once a loop and, when it says so, publishes and tells
// hl_report_sent how that went (a get_status request's publish goes to hl_report_sent too).
//
//   - boot: the first status after power-up, as soon as MQTT is up. Retried until one is queued
//     and acknowledged (a boot status lost with the connection is sent again).
//   - change: mode or relay changed. A change made while MQTT was down, or whose publish failed, or
//     that IoT Core never acknowledged before the connection dropped (MQTT only notices a dead link
//     at its keepalive, and the outbox drops what it couldn't send), is reported as "change" on the
//     first status after the reconnect. A boot status covers any change before it.
//   - heartbeat: 60 s after the last status, and once after every reconnect.
//   - A failed publish is retried after HL_REPORT_RETRY_MS, not on every loop.
//
// "Acknowledged" is the network's word that the latest status has its PUBACK. QoS 1 PUBACKs come
// back in order, so the latest one acknowledged covers every status before it.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "status_json.h"

#define HL_HEARTBEAT_MS 60000
#define HL_REPORT_RETRY_MS 5000

typedef struct
{
    bool boot_pending;       // no boot status has got through yet
    bool change_pending;     // a mode or relay change not yet reported
    bool reconnect_pending;  // connected again: a status is owed
    bool awaiting_ack;       // a boot or change status went out; no PUBACK for it (or later) yet
    hl_reason awaiting;      // which of the two
    bool was_up;
    int64_t last_status_ms;  // the last status queued, of any reason
    int64_t retry_at_ms;     // after a failed publish, nothing before this
} hl_reporter;

void hl_report_init(hl_reporter *r);

// One loop: `changed` = mode or relay changed this loop; `mqtt` = connected; `acked` = the latest
// status queued has been acknowledged. True (and *reason set) when a status should go out now.
bool hl_report_due(hl_reporter *r, int64_t now_ms, bool mqtt, bool changed, bool acked, hl_reason *reason);

// After any status publish: ok = it was queued for IoT Core.
void hl_report_sent(hl_reporter *r, int64_t now_ms, hl_reason reason, bool ok);
