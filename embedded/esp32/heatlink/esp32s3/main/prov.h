// This heatlink's own settings and IoT credentials, read from the `prov` NVS partition that a
// provisioning script writes. Nothing here is in the firmware image, so every heatlink runs the same
// image and a published update holds no secrets.
//
// INSECURE, TEST ONLY: the device private key sits in plain flash.
#pragma once

#include <stdbool.h>
#include <stddef.h>

typedef struct
{
    char wifi_ssid[33];
    char wifi_password[65];
    char iot_endpoint[128];
    char thing_name[129];  // also the MQTT client id
    char *device_cert;     // PEM, malloc'd
    char *device_key;      // PEM, malloc'd
} prov_t;

// Reads the partition. False (and a log line saying what's missing) if the heatlink isn't provisioned.
bool prov_load(prov_t *prov);

// The board this heatlink was provisioned as (board.h), read on its own because the GPIOs need it
// before the rest. "" if never provisioned, or provisioned before the key existed; "?" (no board) if
// the partition or key can't be read, e.g. damaged, or a name too long for `size`.
void prov_board(char *out, size_t size);
