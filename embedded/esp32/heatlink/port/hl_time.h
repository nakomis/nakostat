// Wall clock to the schedule's local time, through a POSIX TZ string (newlib on the S3, libc on the
// host: both read rules like "GMT0BST,M3.5.0/1,M10.5.0"). Portable, so the host tests the
// Europe/London changeovers.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "schedule.h"

// Earliest wall clock taken as set: 2025-01-01T00:00:00Z. Before SNTP the S3's clock starts at 1970.
#define HL_TIME_VALID_AFTER 1735689600LL

// Whether a TZ string is acceptable: 1..HL_TZ_MAX-1 printable characters from the POSIX TZ alphabet
// (letters, digits, and , . + - / : < >). Checked before it reaches setenv.
bool hl_tz_valid(const char *tz);

// Makes `tz` the process's time zone (setenv TZ + tzset). Not thread-safe: call from one task.
void hl_tz_apply(const char *tz);

// Whether the wall clock looks set.
bool hl_time_valid(int64_t epoch_s);

// Local time in the zone last applied.
hl_local hl_local_from_epoch(int64_t epoch_s);
