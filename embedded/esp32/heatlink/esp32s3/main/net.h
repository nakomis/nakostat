// Network: Wi-Fi, SNTP and a held-open MQTT connection to AWS IoT Core (mutual TLS with the heatlink's
// own certificate). Fleet's commands arrive on nakostat/<thing>/commands; the heatlink answers on
// .../responses and reports on .../status. Everything here is best effort: the heatlink's own work
// (the switch, the relay and the fallback) never depends on it.
#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "prov.h"

// Called on the MQTT task with one whole command (JSON, not NUL-terminated). Keep it quick.
typedef void (*net_command_cb)(const char *json, size_t len);

// Starts Wi-Fi, SNTP and MQTT in the background and returns at once. `prov` must stay valid for
// the life of the program. On any setup failure it logs and gives up (false).
bool net_start(const prov_t *prov, net_command_cb on_command);

// Publishes on nakostat/<thing>/responses at QoS 1. Queued for the MQTT task; false (and
// dropped) if not connected.
bool net_respond(const char *json);

// Publishes on nakostat/<thing>/status at QoS 1, not retained. Same queueing as net_respond.
bool net_publish_status(const char *json);

// Whether the MQTT connection to IoT Core is up.
bool net_mqtt_connected(void);

// Whether IoT Core has granted the subscription to .../commands on the current connection (a
// successful SUBACK): only then can Fleet reach the heatlink. Cleared on every disconnect.
bool net_subscribed(void);

// Signal strength of the access point in dBm, or 0 if not associated.
int net_rssi(void);
