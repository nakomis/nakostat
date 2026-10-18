#ifndef BOILER_COMMAND_H
#define BOILER_COMMAND_H

#include <stddef.h>
#include <stdint.h>

// Outcome of parsing an MQTT command payload of the form {"on": true|false}.
enum class BoilerCommandResult {
    Ok,           // `on` holds the requested relay state
    InvalidJson,  // payload is not valid JSON
    MissingOn,    // valid JSON, but no boolean "on" field
};

struct BoilerCommand {
    BoilerCommandResult result;
    bool on;
    // On InvalidJson, the ArduinoJson error text (static storage); otherwise "".
    const char* error;
};

// Hardware-independent so it can be unit-tested on the host.
BoilerCommand parseBoilerCommand(const uint8_t* payload, size_t length);

#endif
