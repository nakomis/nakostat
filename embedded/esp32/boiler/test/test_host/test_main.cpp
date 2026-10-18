#include <Arduino.h>
#include <unity.h>

void run_boiler_controller_tests();
void run_boiler_command_tests();

void setUp() { fake_arduino::reset(); }
void tearDown() {}

int main() {
    UNITY_BEGIN();
    run_boiler_controller_tests();
    run_boiler_command_tests();
    return UNITY_END();
}
