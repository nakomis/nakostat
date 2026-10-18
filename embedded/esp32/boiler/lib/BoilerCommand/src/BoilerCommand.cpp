#include "BoilerCommand.h"

#include <ArduinoJson.h>

BoilerCommand parseBoilerCommand(const uint8_t* payload, size_t length) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        return {BoilerCommandResult::InvalidJson, false, err.c_str()};
    }

    JsonVariant on = doc["on"];
    if (!on.is<bool>()) {
        return {BoilerCommandResult::MissingOn, false, ""};
    }
    return {BoilerCommandResult::Ok, on.as<bool>(), ""};
}
