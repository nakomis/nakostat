// Wi-Fi + SNTP + MQTT to AWS IoT Core. See net.h.
//
// The heatlink subscribes to nakostat/<thing>/commands, hands each command to the callback given to
// net_start (on the MQTT task), and answers on .../responses. Its settings and certificate come
// from the prov partition (prov.h), not the image.
#include "net.h"
#include "ota.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "mqtt_client.h"

static const char *TAG = "net";

extern const char root_ca_start[] asm("_binary_AmazonRootCA1_pem_start");

// Wi-Fi reconnect backoff, so a wrong password or a missing AP doesn't spin the radio.
#define WIFI_RETRY_MIN_MS 1000
#define WIFI_RETRY_MAX_MS 30000

// Fleet's commands can carry a presigned URL of ~1.5 KB (longer ones arrive in chunks).
#define MQTT_BUFFER_SIZE 4096

static const prov_t *prov;
static net_command_cb command_cb;
static char commands_topic[sizeof(prov->thing_name) + 32];
static char responses_topic[sizeof(prov->thing_name) + 32];
static char status_topic[sizeof(prov->thing_name) + 32];
static int subscribe_msg_id = -1;
static esp_mqtt_client_handle_t mqtt;
static volatile bool mqtt_connected;
static volatile bool mqtt_subscribed;  // IoT Core granted the commands subscription on this connection
static esp_timer_handle_t wifi_retry;
static uint32_t wifi_retry_ms = WIFI_RETRY_MIN_MS;
static bool started;

static void wifi_retry_fire(void *arg)
{
    (void)arg;
    esp_err_t err = esp_wifi_connect();
    if (err != ESP_OK)
        ESP_LOGW(TAG, "esp_wifi_connect: %s", esp_err_to_name(err));
}

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START)
        wifi_retry_fire(NULL);
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
    {
        // MQTT only notices a dead socket at its next keepalive; stop queueing into it now.
        mqtt_connected = false;
        mqtt_subscribed = false;
        ESP_LOGW(TAG, "Wi-Fi disconnected (reason %d), retrying in %" PRIu32 " ms",
                 ((wifi_event_sta_disconnected_t *)data)->reason, wifi_retry_ms);
        esp_timer_start_once(wifi_retry, (uint64_t)wifi_retry_ms * 1000);
        wifi_retry_ms = wifi_retry_ms * 2 > WIFI_RETRY_MAX_MS ? WIFI_RETRY_MAX_MS : wifi_retry_ms * 2;
    }
    else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
    {
        wifi_retry_ms = WIFI_RETRY_MIN_MS;
        ESP_LOGI(TAG, "Wi-Fi up, IP " IPSTR, IP2STR(&((ip_event_got_ip_t *)data)->ip_info.ip));
    }
}

static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    esp_mqtt_event_handle_t event = data;
    switch ((esp_mqtt_event_id_t)id)
    {
    case MQTT_EVENT_CONNECTED:
        mqtt_connected = true;
        mqtt_subscribed = false;
        ESP_LOGI(TAG, "MQTT connected to IoT Core as %s", prov->thing_name);
        // A clean session each time, so subscribe on every connect.
        subscribe_msg_id = esp_mqtt_client_subscribe(mqtt, commands_topic, 1);
        break;
    case MQTT_EVENT_DISCONNECTED:
        mqtt_connected = false;
        mqtt_subscribed = false;
        ESP_LOGW(TAG, "MQTT disconnected");
        break;
    case MQTT_EVENT_SUBSCRIBED:
        // A SUBACK can refuse (0x80): then the heatlink can't take updates, and a new image isn't kept
        // (the app only marks an image healthy once net_subscribed() is true).
        if (event->msg_id == subscribe_msg_id && event->error_handle->error_type == MQTT_ERROR_TYPE_SUBSCRIBE_FAILED)
            ESP_LOGE(TAG, "subscription to %s refused", commands_topic);
        else if (event->msg_id == subscribe_msg_id)
        {
            mqtt_subscribed = true;
            ESP_LOGI(TAG, "listening for Fleet on %s", commands_topic);
            ota_on_connected();
        }
        break;
    case MQTT_EVENT_DATA:
        // Commands only (the one subscription). One that didn't fit the buffer arrives in pieces:
        // refuse it rather than parse a fragment.
        if (event->current_data_offset != 0)
            break;
        if (event->total_data_len != event->data_len)
        {
            ESP_LOGW(TAG, "command of %d bytes doesn't fit the %d-byte buffer", event->total_data_len,
                     MQTT_BUFFER_SIZE);
            net_respond("{\"type\":\"error\",\"message\":\"Command too long\"}");
            break;
        }
        if (command_cb != NULL)
            command_cb(event->data, (size_t)event->data_len);
        break;
    case MQTT_EVENT_PUBLISHED:
        ESP_LOGI(TAG, "msg %d acknowledged by IoT Core", event->msg_id);
        break;
    case MQTT_EVENT_ERROR:
        if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT)
            ESP_LOGW(TAG, "MQTT transport error: tls 0x%x, stack 0x%x, errno %d",
                     event->error_handle->esp_tls_last_esp_err, event->error_handle->esp_tls_stack_err,
                     event->error_handle->esp_transport_sock_errno);
        else
            ESP_LOGW(TAG, "MQTT error type %d, connect return code %d", event->error_handle->error_type,
                     event->error_handle->connect_return_code);
        break;
    default:
        break;
    }
}

// Logs and gives up rather than aborting: the rest of the heatlink must keep working without the network.
#define TRY(x)                                                                \
    do                                                                        \
    {                                                                         \
        esp_err_t err_ = (x);                                                 \
        if (err_ != ESP_OK)                                                   \
        {                                                                     \
            ESP_LOGE(TAG, "%s failed: %s; network off", #x, esp_err_to_name(err_)); \
            return false;                                                     \
        }                                                                     \
    } while (0)

bool net_start(const prov_t *p, net_command_cb on_command)
{
    if (p == NULL)
    {
        ESP_LOGE(TAG, "network off: the heatlink isn't provisioned");
        return false;
    }
    prov = p;
    command_cb = on_command;
    snprintf(commands_topic, sizeof(commands_topic), "nakostat/%s/commands", prov->thing_name);
    snprintf(responses_topic, sizeof(responses_topic), "nakostat/%s/responses", prov->thing_name);
    snprintf(status_topic, sizeof(status_topic), "nakostat/%s/status", prov->thing_name);

    TRY(esp_netif_init());
    TRY(esp_event_loop_create_default());
    if (esp_netif_create_default_wifi_sta() == NULL)
    {
        ESP_LOGE(TAG, "no Wi-Fi station interface; network off");
        return false;
    }
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    TRY(esp_wifi_init(&init));
    const esp_timer_create_args_t retry = {.callback = wifi_retry_fire, .name = "wifi_retry"};
    TRY(esp_timer_create(&retry, &wifi_retry));
    TRY(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    TRY(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));

    wifi_config_t sta = {0};
    strlcpy((char *)sta.sta.ssid, prov->wifi_ssid, sizeof(sta.sta.ssid));
    strlcpy((char *)sta.sta.password, prov->wifi_password, sizeof(sta.sta.password));
    sta.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    TRY(esp_wifi_set_mode(WIFI_MODE_STA));
    TRY(esp_wifi_set_config(WIFI_IF_STA, &sta));
    TRY(esp_wifi_start());
    // No modem sleep: a held-open connection should answer at once, not on the next DTIM beacon.
    TRY(esp_wifi_set_ps(WIFI_PS_NONE));

    esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    TRY(esp_netif_sntp_init(&sntp));

    static char uri[sizeof(prov->iot_endpoint) + 16];
    snprintf(uri, sizeof(uri), "mqtts://%s:8883", prov->iot_endpoint);
    const esp_mqtt_client_config_t config = {
        .broker = {
            .address.uri = uri,
            .verification.certificate = root_ca_start,
        },
        .credentials = {
            .client_id = prov->thing_name,
            .authentication = {.certificate = prov->device_cert, .key = prov->device_key},
        },
        .session.keepalive = 60,
        .network.reconnect_timeout_ms = 5000,
        .buffer.size = MQTT_BUFFER_SIZE,
    };
    mqtt = esp_mqtt_client_init(&config);
    if (mqtt == NULL)
    {
        ESP_LOGE(TAG, "esp_mqtt_client_init failed; network off");
        return false;
    }
    TRY(esp_mqtt_client_register_event(mqtt, ESP_EVENT_ANY_ID, mqtt_event, NULL));
    TRY(esp_mqtt_client_start(mqtt));
    started = true;
    ESP_LOGI(TAG, "starting: Wi-Fi \"%s\", IoT Core %s, commands on %s", prov->wifi_ssid, prov->iot_endpoint,
             commands_topic);
    return true;
}

// Enqueued for the MQTT task to send, so the caller doesn't wait on the network. QoS 1, not
// retained; the outbox drops anything unsent after CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS.
static bool publish(const char *topic, const char *json)
{
    if (!started || !mqtt_connected)
    {
        ESP_LOGW(TAG, "not connected: message for %s dropped", topic);
        return false;
    }
    int msg_id = esp_mqtt_client_enqueue(mqtt, topic, json, 0, 1, 0, true);
    ESP_LOGI(TAG, "queued for %s (msg %d): %s", topic, msg_id, json);
    return msg_id >= 0;
}

bool net_respond(const char *json)
{
    return publish(responses_topic, json);
}

bool net_publish_status(const char *json)
{
    return publish(status_topic, json);
}

bool net_mqtt_connected(void)
{
    return mqtt_connected;
}

bool net_subscribed(void)
{
    return mqtt_connected && mqtt_subscribed;
}

int net_rssi(void)
{
    wifi_ap_record_t ap;
    return started && esp_wifi_sta_get_ap_info(&ap) == ESP_OK ? ap.rssi : 0;
}
