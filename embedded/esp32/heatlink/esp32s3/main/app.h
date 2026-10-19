// The application: one task and one queue that own the heatlink's state. MQTT commands arrive as
// events; the task also polls the switch every 20 ms, decides the mode and relay (port/heatlink.c),
// drives the relay and LED, and publishes /status every 60 s and on every change.
#pragma once

#include <stddef.h>

// Configures the hardware (relay off), loads the stored schedule and starts the app task. Call
// before net_start: the relay, switch and fallback run whether or not the network does.
void app_start(void);

// net_start's command callback (MQTT task): copies the command into an event for the app task.
void app_on_command(const char *json, size_t len);
