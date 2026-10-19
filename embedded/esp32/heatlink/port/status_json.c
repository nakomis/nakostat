// The /status JSON. See status_json.h.
#include "status_json.h"

#include <stdio.h>

typedef struct
{
    char *out;
    size_t cap, len;
    bool ok;
} sink;

static void put_raw(sink *s, const char *str)
{
    for (; *str; str++)
    {
        if (s->len + 1 >= s->cap)
        {
            s->ok = false;
            return;
        }
        s->out[s->len++] = *str;
    }
}

static void put_long(sink *s, long v)
{
    char tmp[24];
    snprintf(tmp, sizeof tmp, "%ld", v);
    put_raw(s, tmp);
}

static void put_u32(sink *s, uint32_t v)
{
    char tmp[16];
    snprintf(tmp, sizeof tmp, "%lu", (unsigned long)v);  // long is 32 bits on the S3: never cast to it
    put_raw(s, tmp);
}

static void put_string(sink *s, const char *str)
{
    if (!str)
    {
        put_raw(s, "null");
        return;
    }
    put_raw(s, "\"");
    for (; *str; str++)
    {
        unsigned char c = (unsigned char)*str;
        char tmp[8];
        if (c == '"' || c == '\\')
        {
            tmp[0] = '\\';
            tmp[1] = (char)c;
            tmp[2] = 0;
        }
        else if (c < 0x20)
            snprintf(tmp, sizeof tmp, "\\u%04x", c);
        else
        {
            tmp[0] = (char)c;
            tmp[1] = 0;
        }
        put_raw(s, tmp);
    }
    put_raw(s, "\"");
}

static void put_bool(sink *s, bool b)
{
    put_raw(s, b ? "true" : "false");
}

const char *hl_reason_name(hl_reason reason)
{
    switch (reason)
    {
    case HL_REASON_BOOT:
        return "boot";
    case HL_REASON_HEARTBEAT:
        return "heartbeat";
    case HL_REASON_CHANGE:
        return "change";
    case HL_REASON_REQUEST:
        return "request";
    }
    return "?";
}

int hl_status_json(char *out, size_t cap, const hl_status *v)
{
    if (!out || cap == 0 || !v)
        return -1;
    sink s = {out, cap, 0, true};

    put_raw(&s, "{\"mode\":");
    put_string(&s, hl_mode_name(v->mode));
    put_raw(&s, ",\"relay\":");
    put_bool(&s, v->relay);
    put_raw(&s, ",\"switch\":");
    put_string(&s, hl_switch_name(v->sw));
    put_raw(&s, ",\"source\":");
    put_string(&s, hl_source_name(v->source));
    put_raw(&s, ",\"demand_age_s\":");
    if (v->have_demand)
        put_u32(&s, v->demand_age_s);
    else
        put_raw(&s, "null");
    put_raw(&s, ",\"schedule_known\":");
    put_bool(&s, v->schedule_known);
    put_raw(&s, ",\"time_valid\":");
    put_bool(&s, v->time_valid);
    put_raw(&s, ",\"rssi\":");
    if (v->have_rssi)
        put_long(&s, v->rssi);
    else
        put_raw(&s, "null");
    put_raw(&s, ",\"uptime_s\":");
    put_u32(&s, v->uptime_s);
    put_raw(&s, ",\"reason\":");
    put_string(&s, hl_reason_name(v->reason));
    put_raw(&s, ",\"version\":");
    put_string(&s, v->version);
    put_raw(&s, "}");

    if (!s.ok)
        return -1;
    out[s.len] = '\0';
    return (int)s.len;
}
