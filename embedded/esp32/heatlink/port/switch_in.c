// Switch reading and debounce. See switch_in.h.
#include "switch_in.h"

hl_switch hl_switch_from_pins(bool on_low, bool off_low)
{
    if (off_low)
        return HL_SW_OFF;  // including both low: a fault, so the safe side
    return on_low ? HL_SW_ON : HL_SW_AUTO;
}

bool hl_debounce_update(hl_debounce *d, hl_switch raw, int64_t now_ms)
{
    if (!d->started)
    {
        d->started = true;
        d->stable = d->candidate = raw;
        d->since_ms = now_ms;
        return false;
    }
    if (raw != d->candidate)
    {
        d->candidate = raw;
        d->since_ms = now_ms;
    }
    if (d->candidate != d->stable && now_ms - d->since_ms >= HL_DEBOUNCE_MS)
    {
        d->stable = d->candidate;
        return true;
    }
    return false;
}
