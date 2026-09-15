/**
 * NakostatBoiler - Main Application
 *
 * ESP32-S3-WROOM N16R8 CAM
 * - 16MB Flash, 8MB PSRAM
 * - SD Card (4-bit SDMMC) on GPIO 1, 38, 39, 40, 41, 42
 * - Boiler relay on GPIO 14 (active-high)
 * - BLE for OTA
 * - MQTT (AWS IoT) for setpoint commands & status
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Project libraries
#include "SDLogger.h"
#include "WifiConnect.h"
#include "OTAUpdate.h"
#include "BluetoothOTA.h"
#include "BoilerController.h"

#include "version.h"
#include "secrets.h"

// ===== Boiler hardware config =====
#ifndef BOILER_RELAY_PIN
#  define BOILER_RELAY_PIN 14
#endif
#ifndef BOILER_RELAY_ACTIVE_LOW
#  define BOILER_RELAY_ACTIVE_LOW 0
#endif
// If no command arrives within this many ms, the relay is forced off
// (fail-safe). Pi side is expected to publish at ~10s cadence.
static const unsigned long WATCHDOG_MS = 90UL * 1000UL;
static const unsigned long STATUS_HEARTBEAT_MS = 30UL * 1000UL;

// ===== Globals =====
WifiConnect wifi;
OTAUpdate otaUpdate;

BLEServer* pServer = nullptr;
BluetoothOTA bluetoothOTA;

WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
BoilerController boiler(BOILER_RELAY_PIN, BOILER_RELAY_ACTIVE_LOW != 0, WATCHDOG_MS);

static bool sdCardReady = false;
static bool deviceConnected = false;
static bool oldDeviceConnected = false;
static unsigned long lastStatusPublishMs = 0;
static unsigned long lastMqttReconnectAttemptMs = 0;

class ServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        deviceConnected = true;
        Serial.println("BLE client connected");
        if (sdCardReady) LOG_I("BLE client connected");
    }
    void onDisconnect(BLEServer* pServer) override {
        deviceConnected = false;
        Serial.println("BLE client disconnected");
        if (sdCardReady) LOG_I("BLE client disconnected");
    }
};

void initSDCard() {
    Serial.println("Initializing SD card...");
    sdCardReady = SDLogger::getInstance().init("/logs");
    if (sdCardReady) {
        LOG_I("=== NakostatBoiler Started ===");
        LOG_IF("Version: %s", FIRMWARE_VERSION);
        LOG_IF("Env: %s", NAKOSTAT_ENV);
        LOG_IF("Build: %s %s", __DATE__, __TIME__);
    } else {
        Serial.println("SD card initialization failed - continuing without logging");
    }
}

void initBLE() {
    Serial.println("Initializing BLE...");
    BLEDevice::init(AWS_IOT_THING_NAME);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());

    bluetoothOTA.setOTAUpdate(&otaUpdate);
    bluetoothOTA.initWithExistingServer(pServer);

    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->start();
    Serial.printf("BLE advertising as '%s'\n", AWS_IOT_THING_NAME);
}

void initWiFi() {
    Serial.println("Connecting to WiFi (credentials from secrets.h)...");
    if (wifi.connect() == 0) {
        Serial.printf("WiFi connected: %s\n", WiFi.localIP().toString().c_str());
        if (sdCardReady) LOG_IF("WiFi connected: %s", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("WiFi connection failed");
        if (sdCardReady) LOG_W("WiFi connection failed");
    }
}

void publishStatus(const char* reason) {
    if (!mqtt.connected()) return;

    StaticJsonDocument<256> doc;
    doc["thing"]   = AWS_IOT_THING_NAME;
    doc["env"]     = NAKOSTAT_ENV;
    doc["version"] = FIRMWARE_VERSION;
    doc["on"]      = boiler.isOn();
    doc["watchdog_expired"] = boiler.isWatchdogExpired();
    doc["ms_since_command"] = boiler.msSinceLastCommand();
    doc["uptime_ms"] = millis();
    doc["wifi_rssi"] = WiFi.RSSI();
    doc["reason"]  = reason;

    char buf[256];
    size_t n = serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(MQTT_STATUS_TOPIC, (const uint8_t*)buf, n, false);
    lastStatusPublishMs = millis();
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
    Serial.printf("MQTT rx [%s] %u bytes\n", topic, length);
    if (strcmp(topic, MQTT_COMMAND_TOPIC) != 0) return;

    StaticJsonDocument<128> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("MQTT JSON parse error: %s\n", err.c_str());
        if (sdCardReady) LOG_WF("MQTT JSON parse error: %s", err.c_str());
        return;
    }

    if (!doc.containsKey("on") || !doc["on"].is<bool>()) {
        Serial.println("MQTT command missing 'on' bool");
        return;
    }

    bool on = doc["on"].as<bool>();
    bool wasOn = boiler.isOn();
    boiler.setOn(on);
    if (sdCardReady) LOG_IF("Boiler %s (was %s)", on ? "ON" : "OFF", wasOn ? "ON" : "OFF");
    publishStatus("command");
}

bool mqttConnect() {
    Serial.printf("Connecting to MQTT %s as %s...\n", AWS_IOT_ENDPOINT, AWS_IOT_THING_NAME);
    tlsClient.setCACert(AWS_CERT_CA);
    tlsClient.setCertificate(AWS_CERT_CRT);
    tlsClient.setPrivateKey(AWS_CERT_PRIVATE);
    mqtt.setServer(AWS_IOT_ENDPOINT, 8883);
    mqtt.setBufferSize(512);
    mqtt.setCallback(onMqttMessage);

    if (!mqtt.connect(AWS_IOT_THING_NAME)) {
        Serial.printf("MQTT connect failed, state=%d\n", mqtt.state());
        if (sdCardReady) LOG_WF("MQTT connect failed, state=%d", mqtt.state());
        return false;
    }
    Serial.println("MQTT connected");
    if (sdCardReady) LOG_I("MQTT connected");

    if (!mqtt.subscribe(MQTT_COMMAND_TOPIC, 1)) {
        Serial.printf("MQTT subscribe to %s failed\n", MQTT_COMMAND_TOPIC);
        if (sdCardReady) LOG_WF("MQTT subscribe failed: %s", MQTT_COMMAND_TOPIC);
    } else {
        Serial.printf("Subscribed to %s\n", MQTT_COMMAND_TOPIC);
    }
    publishStatus("connect");
    return true;
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n================================");
    Serial.printf("NakostatBoiler %s (%s)\n", FIRMWARE_VERSION, NAKOSTAT_ENV);
    Serial.printf("Relay GPIO %d (%s)\n", BOILER_RELAY_PIN,
                  BOILER_RELAY_ACTIVE_LOW ? "active-low" : "active-high");
    Serial.println("================================\n");

    boiler.begin();   // GPIO low / relay off before anything else
    initSDCard();
    initWiFi();
    initBLE();
    if (WiFi.status() == WL_CONNECTED) {
        mqttConnect();
    }
}

void loop() {
    bluetoothOTA.handle();

    if (deviceConnected && !oldDeviceConnected) oldDeviceConnected = deviceConnected;
    if (!deviceConnected && oldDeviceConnected) {
        delay(500);
        BLEDevice::getAdvertising()->start();
        oldDeviceConnected = deviceConnected;
    }

    // MQTT keepalive / reconnect
    if (WiFi.status() == WL_CONNECTED) {
        if (!mqtt.connected()) {
            unsigned long now = millis();
            if (now - lastMqttReconnectAttemptMs > 5000) {
                lastMqttReconnectAttemptMs = now;
                mqttConnect();
            }
        } else {
            mqtt.loop();
        }
    }

    // Watchdog: if no command in WATCHDOG_MS, force relay off
    if (boiler.loop()) {
        Serial.println("WATCHDOG: no command, forcing relay OFF");
        if (sdCardReady) LOG_W("WATCHDOG tripped, relay OFF");
        publishStatus("watchdog");
    }

    // Periodic heartbeat
    if (mqtt.connected() && millis() - lastStatusPublishMs > STATUS_HEARTBEAT_MS) {
        publishStatus("heartbeat");
    }

    delay(20);
}
