// The application task: switch, demand, schedule, relay, LED, commands and status. See app.h.
#include "app.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "heatlink.h"
#include "hl_cmd.h"
#include "hl_time.h"
#include "io.h"
#include "led.h"
#include "net.h"
#include "nvs.h"
#include "ota.h"
#include "schedule.h"
#include "status_json.h"
#include "switch_in.h"

static const char *TAG = "app";

#define NVS_NAMESPACE "heatlink"
#define NVS_KEY_SCHEDULE "schedule"
#define SCHEDULE_FORMAT 1  // the stored blob's layout; bump when hl_schedule changes

// Fleet's largest message is an ota_update of at most ~1500 bytes (longer URLs come as url_chunks);
// a full set_schedule is under 2 KB (tests/test_hl_cmd.py). Anything longer is refused.
#define CMD_MAX_LEN 2048
#define QUEUE_LEN 8
#define TASK_STACK 8192  // cJSON and the command parsers run here, not on the MQTT task
#define TASK_PRIORITY 5
#define HEARTBEAT_MS 60000
#define RESTART_DELAY_MS 2000  // for the response to reach IoT Core first
#define STATUS_MAX 384

typedef struct
{
    char *json;  // malloc'd, NUL-terminated; the app task frees it
    size_t len;
} app_event;

typedef struct
{
    uint8_t format;
    hl_schedule schedule;
} stored_schedule;

static QueueHandle_t queue;

// Owned by the app task.
static hl_demand demand;
static hl_schedule schedule;
static bool schedule_known;
static hl_debounce debounce;
static hl_output current;
static bool time_valid;
static bool healthy, mqtt_was_up, boot_reported;
static int64_t last_heartbeat_ms;

static int64_t now_ms(void)
{
    return esp_timer_get_time() / 1000;
}

// ---- events from the MQTT task ---------------------------------------------------------------

void app_on_command(const char *json, size_t len)
{
    if (len > CMD_MAX_LEN)
    {
        ESP_LOGW(TAG, "command of %u bytes refused", (unsigned)len);
        net_respond("{\"type\":\"error\",\"message\":\"Command too long\"}");
        return;
    }
    app_event ev = {.json = malloc(len + 1), .len = len};
    if (ev.json == NULL)
    {
        net_respond("{\"type\":\"error\",\"message\":\"Out of memory\"}");
        return;
    }
    memcpy(ev.json, json, len);
    ev.json[len] = '\0';
    if (queue == NULL || xQueueSend(queue, &ev, 0) != pdTRUE)
    {
        free(ev.json);
        net_respond("{\"type\":\"error\",\"message\":\"Busy: try again\"}");
    }
}

// ---- NVS: the schedule ---------------------------------------------------------------------------

static bool load_schedule(hl_schedule *out)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK)
        return false;
    stored_schedule stored;
    size_t len = sizeof(stored);
    bool ok = nvs_get_blob(h, NVS_KEY_SCHEDULE, &stored, &len) == ESP_OK && len == sizeof(stored) &&
              stored.format == SCHEDULE_FORMAT && hl_schedule_valid(&stored.schedule);
    nvs_close(h);
    if (ok)
        *out = stored.schedule;
    return ok;
}

static esp_err_t store_schedule(const hl_schedule *s)
{
    stored_schedule stored;
    memset(&stored, 0, sizeof(stored));  // padding too, so the blob compares equal next time
    stored.format = SCHEDULE_FORMAT;
    stored.schedule = *s;
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h);
    if (err != ESP_OK)
        return err;
    err = nvs_set_blob(h, NVS_KEY_SCHEDULE, &stored, sizeof(stored));
    if (err == ESP_OK)
        err = nvs_commit(h);
    nvs_close(h);
    return err;
}

// ---- status and responses -----------------------------------------------------------------------

static void publish_status(hl_reason reason)
{
    int64_t now = now_ms();
    int rssi = net_rssi();
    hl_status v = {
        .mode = current.mode,
        .relay = current.relay,
        .sw = debounce.stable,
        .source = current.source,
        .have_demand = demand.have,
        .demand_age_s = demand.have ? (uint32_t)((now - demand.received_ms) / 1000) : 0,
        .schedule_known = schedule_known,
        .time_valid = time_valid,
        .have_rssi = rssi != 0,
        .rssi = rssi,
        .uptime_s = (uint32_t)(now / 1000),
        .reason = reason,
        .version = esp_app_get_description()->version,
    };
    char text[STATUS_MAX];
    if (hl_status_json(text, sizeof(text), &v) < 0)
    {
        ESP_LOGE(TAG, "status doesn't fit %u bytes", (unsigned)sizeof(text));
        return;
    }
    if (net_publish_status(text))
        last_heartbeat_ms = now;  // any status resets the heartbeat
}

// {"type":..., "message":...}, plus "status" for a command's own result (Fleet's envelope).
static void respond(const char *type, const char *status, const char *message)
{
    cJSON *msg = cJSON_CreateObject();
    if (msg == NULL)
        return;
    cJSON_AddStringToObject(msg, "type", type);
    if (status != NULL)
        cJSON_AddStringToObject(msg, "status", status);
    cJSON_AddStringToObject(msg, "message", message);
    char *text = cJSON_PrintUnformatted(msg);
    if (text != NULL)
        net_respond(text);
    cJSON_free(text);
    cJSON_Delete(msg);
}

// ---- commands ------------------------------------------------------------------------------------

static void set_schedule(const hl_schedule *s)
{
    if (schedule_known && memcmp(s, &schedule, sizeof(*s)) == 0)
    {
        respond("set_schedule_result", "ok", "unchanged");  // the daemon resends every 6 h
        return;
    }
    esp_err_t err = store_schedule(s);
    if (err != ESP_OK)
        ESP_LOGE(TAG, "couldn't store the schedule (%s): kept in RAM only", esp_err_to_name(err));
    bool tz_changed = !schedule_known || strcmp(s->tz, schedule.tz) != 0;
    schedule = *s;
    schedule_known = true;
    if (tz_changed)
        hl_tz_apply(schedule.tz);
    ESP_LOGI(TAG, "schedule received: comfort %d centi-degC, duty %u%%, tz %s", schedule.comfort_centi,
             schedule.duty_pct, schedule.tz);
    respond("set_schedule_result", err == ESP_OK ? "ok" : "error", err == ESP_OK ? "stored" : "not stored: kept until reboot");
}

static void handle_command(const char *json, size_t len)
{
    static hl_cmd cmd;  // holds a schedule: not on the task's stack
    hl_cmd_parse(json, len, &cmd);
    switch (cmd.kind)
    {
    case HL_CMD_DEMAND:
        // No reply: the daemon sends one every 30 s. /status says what came of it.
        if (!demand.have || demand.on != cmd.on || demand.source != cmd.source)
            ESP_LOGI(TAG, "demand %s (%s), ttl %u s", cmd.on ? "on" : "off", hl_source_name(cmd.source),
                     (unsigned)cmd.ttl_s);
        demand = (hl_demand){.have = true, .on = cmd.on, .source = cmd.source, .received_ms = now_ms(),
                             .ttl_s = cmd.ttl_s};
        break;
    case HL_CMD_SET_SCHEDULE:
        set_schedule(&cmd.schedule);
        break;
    case HL_CMD_GET_STATUS:
        publish_status(HL_REASON_REQUEST);
        break;
    case HL_CMD_REBOOT:
        respond("reboot_result", "ok", "rebooting");
        vTaskDelay(pdMS_TO_TICKS(RESTART_DELAY_MS));
        esp_restart();
        break;
    case HL_CMD_FLEET:
        ota_handle_command(json, len);
        break;
    case HL_CMD_ERROR:
        ESP_LOGW(TAG, "command refused: %s", cmd.message);
        respond("error", NULL, cmd.message);
        break;
    }
}

// ---- the loop ------------------------------------------------------------------------------------

// Polls the switch, reads the clock and decides. Returns whether the mode or relay changed.
static bool step(void)
{
    int64_t now = now_ms();
    hl_debounce_update(&debounce, io_read_switch(), now);

    time_t wall = time(NULL);
    time_valid = hl_time_valid((int64_t)wall);
    hl_inputs in = {
        .sw = debounce.stable,
        .demand = demand,
        .now_ms = now,
        .schedule = schedule_known ? &schedule : NULL,
        .time_valid = time_valid,
    };
    if (time_valid)
        in.local = hl_local_from_epoch((int64_t)wall);
    hl_output out = hl_decide(&in);

    bool changed = out.mode != current.mode || out.relay != current.relay;
    if (out.relay != current.relay)
        io_set_relay(out.relay);
    if (changed)
        ESP_LOGI(TAG, "%s, relay %s (%s; switch %s)", hl_mode_name(out.mode), out.relay ? "on" : "off",
                 hl_source_name(out.source), hl_switch_name(debounce.stable));
    current = out;
    io_set_led(hl_led_colour(current.mode, current.relay, net_mqtt_connected(), now));
    return changed;
}

static void app_task(void *arg)
{
    (void)arg;
    for (;;)
    {
        app_event ev;
        if (xQueueReceive(queue, &ev, pdMS_TO_TICKS(HL_SWITCH_POLL_MS)) == pdTRUE)
        {
            handle_command(ev.json, ev.len);
            free(ev.json);
        }
        bool changed = step();

        bool mqtt = net_mqtt_connected();
        if (mqtt && !mqtt_was_up)
        {
            // After every (re)connect: the first since boot says so.
            publish_status(boot_reported ? HL_REASON_HEARTBEAT : HL_REASON_BOOT);
            boot_reported = true;
        }
        else if (mqtt && changed)
            publish_status(HL_REASON_CHANGE);
        else if (mqtt && now_ms() - last_heartbeat_ms >= HEARTBEAT_MS)
            publish_status(HL_REASON_HEARTBEAT);
        mqtt_was_up = mqtt;

        // The image is healthy once it can hear Fleet (subscribed, not just connected).
        if (!healthy && net_subscribed())
        {
            healthy = true;
            ota_mark_healthy();
        }
    }
}

void app_start(void)
{
    io_init();

    hl_schedule_init(&schedule);
    schedule_known = load_schedule(&schedule);
    if (!schedule_known)
        hl_schedule_init(&schedule);  // a partial read leaves nothing behind
    hl_tz_apply(schedule.tz);
    ESP_LOGI(TAG, "%s (tz %s)", schedule_known ? "stored schedule loaded" : "no stored schedule yet", schedule.tz);

    // Relay off until the first decision; the first switch reading is taken as it is.
    current = (hl_output){.mode = HL_MODE_AUTO, .relay = false, .source = HL_SRC_OFF};
    io_set_relay(false);
    step();

    queue = xQueueCreate(QUEUE_LEN, sizeof(app_event));
    if (queue == NULL || xTaskCreate(app_task, "app", TASK_STACK, NULL, TASK_PRIORITY, NULL) != pdPASS)
    {
        ESP_LOGE(TAG, "no memory for the app task");
        abort();
    }
}
