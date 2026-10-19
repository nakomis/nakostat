// The heatlink's decision table. See heatlink.h.
#include "heatlink.h"

#include <math.h>
#include <string.h>

static hl_output out(hl_mode mode, bool relay, hl_source source)
{
    return (hl_output){.mode = mode, .relay = relay, .source = source};
}

hl_output hl_decide(const hl_inputs *in)
{
    if (in->sw == HL_SW_ON)
        return out(HL_MODE_FORCE_ON, true, HL_SRC_SWITCH);
    if (in->sw == HL_SW_OFF)
        return out(HL_MODE_FORCE_OFF, false, HL_SRC_SWITCH);

    const hl_demand *d = &in->demand;
    if (d->have)
    {
        int64_t age_ms = in->now_ms - d->received_ms;
        if (age_ms >= 0 && age_ms < (int64_t)d->ttl_s * 1000)
            return out(HL_MODE_AUTO, d->on, d->source);
    }
    else if (in->now_ms < (int64_t)HL_TTL_DEFAULT_S * 1000)
        return out(HL_MODE_AUTO, false, HL_SRC_OFF);  // cold boot: wait one ttl for the daemon

    bool heat = in->schedule != NULL && in->time_valid && hl_fallback_heat(in->schedule, in->local);
    return out(HL_MODE_FALLBACK, heat, HL_SRC_FALLBACK);
}

uint32_t hl_ttl_clamp(double ttl_s)
{
    if (isnan(ttl_s))
        return HL_TTL_DEFAULT_S;
    if (ttl_s < HL_TTL_MIN_S)
        return HL_TTL_MIN_S;
    if (ttl_s > HL_TTL_MAX_S)
        return HL_TTL_MAX_S;
    return (uint32_t)ttl_s;
}

const char *hl_switch_name(hl_switch sw)
{
    switch (sw)
    {
    case HL_SW_AUTO:
        return "auto";
    case HL_SW_ON:
        return "on";
    case HL_SW_OFF:
        return "off";
    }
    return "?";
}

const char *hl_mode_name(hl_mode mode)
{
    switch (mode)
    {
    case HL_MODE_AUTO:
        return "auto";
    case HL_MODE_FALLBACK:
        return "fallback";
    case HL_MODE_FORCE_ON:
        return "force_on";
    case HL_MODE_FORCE_OFF:
        return "force_off";
    }
    return "?";
}

static const char *const source_names[] = {
    [HL_SRC_SCHEDULE] = "schedule", [HL_SRC_OVERRIDE] = "override", [HL_SRC_FROST] = "frost",
    [HL_SRC_OFF] = "off",           [HL_SRC_FALLBACK] = "fallback", [HL_SRC_SWITCH] = "switch",
};

const char *hl_source_name(hl_source source)
{
    return (unsigned)source < sizeof(source_names) / sizeof(source_names[0]) ? source_names[source] : "?";
}

bool hl_demand_source_parse(const char *name, hl_source *out)
{
    for (hl_source s = HL_SRC_SCHEDULE; s <= HL_SRC_OFF; s++)
        if (strcmp(name, source_names[s]) == 0)
        {
            *out = s;
            return true;
        }
    return false;
}
