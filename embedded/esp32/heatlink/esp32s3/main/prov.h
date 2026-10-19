// This heatlink's own settings and IoT credentials, read from the `prov` NVS partition that a
// provisioning script writes. Nothing here is in the firmware image, so every heatlink runs the same
// image and a published update holds no secrets.
//
// INSECURE, TEST ONLY: the device private key sits in plain flash.
#pragma once

#include <stdbool.h>

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
