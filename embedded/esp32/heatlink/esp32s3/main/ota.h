// Over-the-air updates through Fleet, unsigned.
//
// Fleet only says "please update": ota_update {url, version, sha256} (or url_chunks) on
// nakostat/<thing>/commands. The heatlink then
//   1. downloads the image over HTTPS (Amazon Root CA 1) into the spare slot, hashing as it goes;
//   2. refuses it unless its SHA-256 is Fleet's, it says it is nakostat at that version, and
//      that version is newer than the running one;
//   3. switches slots and restarts.
// There is no signature check and no approval step: the SHA-256 and the project name guard against
// a corrupt or wrong download, and the HTTPS presigned URL from Fleet is the only way in.
// The new image runs on probation and must be marked healthy (ota_mark_healthy) within
// OTA_VERIFY_DEADLINE_S; until then a failure or crash rolls back to the old one, which reports it.
// Progress goes back on nakostat/<thing>/responses as Fleet expects (ota_progress, ota_error,
// ota_complete, and a version message on every connect).
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "ota_cmd.h"
#include "sdkconfig.h"

#define OTA_VERIFY_DEADLINE_S 120

// What a misbehaving Fleet (or anyone who can publish to the commands topic) can cost the heatlink: a
// download erases the spare slot and uses RAM. All of it is kept in RAM: a reboot starts afresh.
#define OTA_DOWNLOAD_DEADLINE_MS (CONFIG_HEATLINK_OTA_DOWNLOAD_DEADLINE_S * 1000)
#define OTA_MIN_RATE_WINDOW_MS 30000  // at least OTA_MIN_RATE_BYTES in every window, or it's abandoned
#define OTA_MIN_RATE_BYTES (32 * 1024)
#define OTA_BACKOFF_FIRST_S 30  // after a failed download; doubles each time, up to OTA_BACKOFF_MAX_S
#define OTA_BACKOFF_MAX_S 900

// At boot, after NVS is up and before the radios start. A new image (pending verification) goes on
// probation: unless ota_mark_healthy() is called within OTA_VERIFY_DEADLINE_S, it is rolled back.
void ota_boot(void);

// From the network (MQTT task): subscribed to commands, so this image can be updated; reports the
// version and, unless the image is still on probation, the outcome of the last update.
void ota_on_connected(void);

// Ends probation and keeps the image. Call once MQTT is subscribed to /commands. Does
// nothing if the image isn't on probation. Reports the outcome of the update once Fleet can hear it.
void ota_mark_healthy(void);

// An update is under way (downloading or installing): RAM is tight, so other network work waits.
bool ota_busy(void);

// From the app task (app.c hands on HL_CMD_FLEET commands): one command from Fleet.
void ota_handle_command(const char *data, size_t len);
