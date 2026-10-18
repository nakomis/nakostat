#include <string.h>
#include <unity.h>

#include "BoilerCommand.h"

namespace {

BoilerCommand parse(const char* json) {
    return parseBoilerCommand(reinterpret_cast<const uint8_t*>(json), strlen(json));
}

void assert_command(const char* json, BoilerCommandResult result, bool on) {
    BoilerCommand cmd = parse(json);
    TEST_ASSERT_TRUE_MESSAGE(cmd.result == result, json);
    TEST_ASSERT_EQUAL_MESSAGE(on, cmd.on, json);
}

void test_valid_commands() {
    assert_command("{\"on\":true}", BoilerCommandResult::Ok, true);
    assert_command("{\"on\": false}", BoilerCommandResult::Ok, false);
    assert_command("{\"setpoint\":20.5,\"on\":true,\"src\":\"pi\"}", BoilerCommandResult::Ok, true);
}

void test_respects_length_of_unterminated_payload() {
    // MQTT payloads are not NUL-terminated; trailing bytes must be ignored.
    const char buf[] = "{\"on\":true}garbage";
    BoilerCommand cmd = parseBoilerCommand(reinterpret_cast<const uint8_t*>(buf), 11);
    TEST_ASSERT_TRUE(cmd.result == BoilerCommandResult::Ok);
    TEST_ASSERT_TRUE(cmd.on);
}

void test_malformed_json_is_invalid() {
    assert_command("{\"on\":tru", BoilerCommandResult::InvalidJson, false);
    TEST_ASSERT_TRUE(strlen(parse("{\"on\":tru").error) > 0);
    BoilerCommand empty = parseBoilerCommand(nullptr, 0);
    TEST_ASSERT_TRUE(empty.result == BoilerCommandResult::InvalidJson);
}

void test_missing_or_non_bool_on_is_rejected() {
    const char* payloads[] = {
        "{}", "{\"off\":true}", "{\"on\":1}", "{\"on\":0}", "{\"on\":\"true\"}",
        "{\"on\":null}", "{\"on\":{}}", "[true]", "true",
    };
    for (const char* p : payloads) {
        assert_command(p, BoilerCommandResult::MissingOn, false);
    }
}

}  // namespace

void run_boiler_command_tests() {
    RUN_TEST(test_valid_commands);
    RUN_TEST(test_respects_length_of_unterminated_payload);
    RUN_TEST(test_malformed_json_is_invalid);
    RUN_TEST(test_missing_or_non_bool_on_is_rejected);
}
