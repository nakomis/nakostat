#include <Arduino.h>
#include <unity.h>

#include "BoilerController.h"

namespace {

const int PIN = 14;
const unsigned long WATCHDOG_MS = 90000;
const unsigned long T0 = 1000;  // time of the first command

// A started controller that received setOn(on) at T0.
BoilerController commanded(bool activeLow, bool on) {
    BoilerController boiler(PIN, activeLow, WATCHDOG_MS);
    boiler.begin();
    fake_arduino::now_ms = T0;
    boiler.setOn(on);
    return boiler;
}

void test_begin_latches_relay_off_then_configures_output() {
    BoilerController boiler(PIN, true, WATCHDOG_MS);
    boiler.begin();
    // Level written before (and after) pinMode() so the relay never glitches on.
    TEST_ASSERT_GREATER_OR_EQUAL(2, fake_arduino::write_count);
    TEST_ASSERT_EQUAL(OUTPUT, fake_arduino::pin_mode[PIN]);
    TEST_ASSERT_EQUAL(HIGH, fake_arduino::pin_level[PIN]);
    TEST_ASSERT_FALSE(boiler.isOn());
    TEST_ASSERT_TRUE(boiler.isWatchdogExpired());  // cold start: no command yet
    TEST_ASSERT_EQUAL_UINT32(0, boiler.msSinceLastCommand());
    fake_arduino::now_ms = 10 * WATCHDOG_MS;
    TEST_ASSERT_FALSE(boiler.loop());
}

void test_relay_polarity() {
    BoilerController high = commanded(false, true);
    TEST_ASSERT_EQUAL(HIGH, fake_arduino::pin_level[PIN]);
    TEST_ASSERT_FALSE(high.isWatchdogExpired());
    high.setOn(false);
    TEST_ASSERT_EQUAL(LOW, fake_arduino::pin_level[PIN]);

    BoilerController low = commanded(true, true);
    TEST_ASSERT_EQUAL(LOW, fake_arduino::pin_level[PIN]);
    TEST_ASSERT_TRUE(low.isOn());
    low.setOn(false);
    TEST_ASSERT_EQUAL(HIGH, fake_arduino::pin_level[PIN]);
}

void test_repeated_command_does_not_rewrite_gpio() {
    BoilerController boiler = commanded(false, true);
    int writes = fake_arduino::write_count;
    fake_arduino::now_ms = T0 + 10000;
    boiler.setOn(true);
    TEST_ASSERT_EQUAL(writes, fake_arduino::write_count);
    TEST_ASSERT_EQUAL_UINT32(0, boiler.msSinceLastCommand());
}

void test_watchdog_does_not_trip_at_exact_timeout() {
    BoilerController boiler = commanded(false, true);
    fake_arduino::now_ms = T0 + WATCHDOG_MS;
    TEST_ASSERT_FALSE(boiler.loop());
    TEST_ASSERT_TRUE(boiler.isOn());
    TEST_ASSERT_EQUAL_UINT32(WATCHDOG_MS, boiler.msSinceLastCommand());
}

void test_watchdog_trips_once_after_timeout_and_forces_relay_off() {
    BoilerController boiler = commanded(false, true);
    fake_arduino::now_ms = T0 + WATCHDOG_MS + 1;
    TEST_ASSERT_TRUE(boiler.loop());
    TEST_ASSERT_FALSE(boiler.isOn());
    TEST_ASSERT_TRUE(boiler.isWatchdogExpired());
    TEST_ASSERT_EQUAL(LOW, fake_arduino::pin_level[PIN]);
    fake_arduino::now_ms += 5000;
    TEST_ASSERT_FALSE(boiler.loop());  // edge reported only once
}

void test_watchdog_trip_while_off_leaves_gpio_alone() {
    BoilerController boiler = commanded(true, false);
    int writes = fake_arduino::write_count;
    fake_arduino::now_ms = T0 + WATCHDOG_MS + 1;
    TEST_ASSERT_TRUE(boiler.loop());
    TEST_ASSERT_EQUAL(writes, fake_arduino::write_count);
    TEST_ASSERT_EQUAL(HIGH, fake_arduino::pin_level[PIN]);
}

void test_regular_commands_keep_watchdog_warm() {
    BoilerController boiler = commanded(false, true);
    for (unsigned long t = T0; t < 10 * WATCHDOG_MS; t += 10000) {
        fake_arduino::now_ms = t;
        boiler.setOn(true);
        fake_arduino::now_ms = t + 9999;
        TEST_ASSERT_FALSE(boiler.loop());
    }
    TEST_ASSERT_TRUE(boiler.isOn());
}

void test_command_after_trip_rearms() {
    BoilerController boiler = commanded(false, true);
    fake_arduino::now_ms = T0 + WATCHDOG_MS + 1;
    boiler.loop();
    boiler.setOn(true);
    TEST_ASSERT_TRUE(boiler.isOn());
    TEST_ASSERT_FALSE(boiler.isWatchdogExpired());
    TEST_ASSERT_EQUAL(HIGH, fake_arduino::pin_level[PIN]);
}

void test_watchdog_survives_millis_rollover() {
    BoilerController boiler(PIN, false, WATCHDOG_MS);
    boiler.begin();
    const unsigned long nearWrap = static_cast<unsigned long>(-1) - 1000;
    fake_arduino::now_ms = nearWrap;
    boiler.setOn(true);
    fake_arduino::now_ms = nearWrap + 5000;  // wraps past zero
    TEST_ASSERT_FALSE(boiler.loop());
    TEST_ASSERT_EQUAL_UINT32(5000, boiler.msSinceLastCommand());
    fake_arduino::now_ms = nearWrap + WATCHDOG_MS + 1;
    TEST_ASSERT_TRUE(boiler.loop());
}

}  // namespace

void run_boiler_controller_tests() {
    RUN_TEST(test_begin_latches_relay_off_then_configures_output);
    RUN_TEST(test_relay_polarity);
    RUN_TEST(test_repeated_command_does_not_rewrite_gpio);
    RUN_TEST(test_watchdog_does_not_trip_at_exact_timeout);
    RUN_TEST(test_watchdog_trips_once_after_timeout_and_forces_relay_off);
    RUN_TEST(test_watchdog_trip_while_off_leaves_gpio_alone);
    RUN_TEST(test_regular_commands_keep_watchdog_warm);
    RUN_TEST(test_command_after_trip_rearms);
    RUN_TEST(test_watchdog_survives_millis_rollover);
}
