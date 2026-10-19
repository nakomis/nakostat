// The heatlink's command parser. See hl_cmd.h.
#include "hl_cmd.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "hl_time.h"

#define MAX_DEPTH 8           // set_schedule nests 4 deep; cJSON recurses per level
#define READING_LIMIT_C 100.0  // sanity bound for the informational setpoint and temperature
#define TS_LIMIT_S 1e15        // sanity bound for a demand's ts

static void fail(hl_cmd *out, const char *message)
{
    out->kind = HL_CMD_ERROR;
    snprintf(out->message, sizeof(out->message), "%s", message);
}

// Nearest 0.01 degC, half away from zero. The caller has bounded c.
static int16_t centi(double c)
{
    return (int16_t)(c * 100.0 + (c < 0 ? -0.5 : 0.5));
}

static int16_t clamp_centi(double c, int16_t lo, int16_t hi)
{
    if (c * 100.0 <= lo)
        return lo;
    if (c * 100.0 >= hi)
        return hi;
    return centi(c);
}

static bool is_finite_number(const cJSON *item)
{
    return cJSON_IsNumber(item) && isfinite(item->valuedouble);
}

// An optional reading: absent is fine; present must be a number within the sanity bound.
static bool reading(const cJSON *root, const char *name, bool *has, int16_t *value)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, name);
    if (item == NULL || cJSON_IsNull(item))
        return true;
    if (!is_finite_number(item) || fabs(item->valuedouble) > READING_LIMIT_C)
        return false;
    *has = true;
    *value = centi(item->valuedouble);
    return true;
}

static void demand(const cJSON *root, hl_cmd *out)
{
    const cJSON *on = cJSON_GetObjectItemCaseSensitive(root, "on");
    if (!cJSON_IsBool(on))
        return fail(out, "demand needs a boolean on");
    out->on = cJSON_IsTrue(on);

    out->source = HL_SRC_OVERRIDE;
    const cJSON *source = cJSON_GetObjectItemCaseSensitive(root, "source");
    if (source != NULL && (!cJSON_IsString(source) || !hl_demand_source_parse(source->valuestring, &out->source)))
        return fail(out, "source must be schedule, override, frost or off");

    out->ttl_s = HL_TTL_DEFAULT_S;
    const cJSON *ttl = cJSON_GetObjectItemCaseSensitive(root, "ttl_s");
    if (ttl != NULL)
    {
        if (!is_finite_number(ttl))
            return fail(out, "ttl_s must be a number");
        out->ttl_s = hl_ttl_clamp(ttl->valuedouble);
    }

    if (!reading(root, "setpoint", &out->has_setpoint, &out->setpoint_centi))
        return fail(out, "setpoint must be a number of degrees");
    if (!reading(root, "temperature", &out->has_temperature, &out->temperature_centi))
        return fail(out, "temperature must be a number of degrees");

    const cJSON *ts = cJSON_GetObjectItemCaseSensitive(root, "ts");
    if (ts != NULL && !cJSON_IsNull(ts))
    {
        // Bounded so the conversion is defined; any real Unix time is far inside it.
        if (!is_finite_number(ts) || fabs(ts->valuedouble) > TS_LIMIT_S)
            return fail(out, "ts must be a number of seconds");
        out->has_ts = true;
        out->ts = (int64_t)ts->valuedouble;
    }
    out->kind = HL_CMD_DEMAND;
}

// Inserts keeping the day sorted; an entry at the same minute is replaced (the later one wins).
static void insert(hl_schedule *s, int day, uint16_t minute, int16_t target)
{
    int n = s->count[day];
    hl_entry *e = s->entry[day];
    int i = 0;
    while (i < n && e[i].minute < minute)
        i++;
    if (i < n && e[i].minute == minute)
    {
        e[i].target_centi = target;
        return;
    }
    memmove(&e[i + 1], &e[i], (size_t)(n - i) * sizeof(*e));
    e[i] = (hl_entry){.minute = minute, .target_centi = target};
    s->count[day] = (uint8_t)(n + 1);
}

static void set_schedule(const cJSON *root, hl_cmd *out)
{
    hl_schedule *s = &out->schedule;
    hl_schedule_init(s);

    const cJSON *days = cJSON_GetObjectItemCaseSensitive(root, "days");
    if (!cJSON_IsArray(days) || cJSON_GetArraySize(days) != HL_DAYS)
        return fail(out, "days must be an array of 7 days, Monday first");
    int d = 0;
    const cJSON *day;
    cJSON_ArrayForEach(day, days)
    {
        if (!cJSON_IsArray(day))
            return fail(out, "each day must be an array of [minute, target_c] entries");
        if (cJSON_GetArraySize(day) > HL_MAX_ENTRIES)
            return fail(out, "at most 8 entries a day");
        const cJSON *entry;
        cJSON_ArrayForEach(entry, day)
        {
            const cJSON *minute = cJSON_GetArrayItem(entry, 0);
            const cJSON *target = cJSON_GetArrayItem(entry, 1);
            if (!cJSON_IsArray(entry) || cJSON_GetArraySize(entry) != 2 || !is_finite_number(minute) ||
                !is_finite_number(target))
                return fail(out, "each entry must be [minute, target_c]");
            double m = minute->valuedouble;
            if (m < 0 || m >= HL_MINUTES_PER_DAY || m != floor(m))
                return fail(out, "minute must be a whole number from 0 to 1439");
            insert(s, d, (uint16_t)m,
                   clamp_centi(target->valuedouble, HL_TARGET_MIN_CENTI, HL_TARGET_MAX_CENTI));
        }
        d++;
    }

    const cJSON *comfort = cJSON_GetObjectItemCaseSensitive(root, "comfort_c");
    if (comfort != NULL)
    {
        if (!is_finite_number(comfort))
            return fail(out, "comfort_c must be a number");
        s->comfort_centi = clamp_centi(comfort->valuedouble, HL_COMFORT_MIN_CENTI, HL_COMFORT_MAX_CENTI);
    }

    const cJSON *duty = cJSON_GetObjectItemCaseSensitive(root, "duty_pct");
    if (duty != NULL)
    {
        if (!is_finite_number(duty))
            return fail(out, "duty_pct must be a number");
        double p = duty->valuedouble;
        s->duty_pct = p <= 0 ? 0 : p >= HL_DUTY_MAX ? HL_DUTY_MAX : (uint8_t)(p + 0.5);
    }

    const cJSON *enabled = cJSON_GetObjectItemCaseSensitive(root, "enabled");
    if (enabled != NULL)
    {
        if (!cJSON_IsBool(enabled))
            return fail(out, "enabled must be true or false");
        s->enabled = cJSON_IsTrue(enabled);
    }

    const cJSON *tz = cJSON_GetObjectItemCaseSensitive(root, "tz");
    if (tz != NULL)
    {
        if (!cJSON_IsString(tz) || !hl_tz_valid(tz->valuestring))
            return fail(out, "tz must be a POSIX TZ string of at most 63 characters");
        snprintf(s->tz, sizeof(s->tz), "%s", tz->valuestring);
    }
    out->kind = HL_CMD_SET_SCHEDULE;
}

// Whether the bracket nesting outside strings ever goes deeper than MAX_DEPTH. Checked before
// cJSON sees the bytes, so a hostile "[[[[..." cannot recurse through the stack.
static bool too_deep(const char *json, size_t len)
{
    int depth = 0;
    bool in_string = false;
    for (size_t i = 0; i < len; i++)
    {
        char c = json[i];
        if (in_string)
        {
            if (c == '\\')
                i++;  // skip the escaped character, so \" does not end the string
            else if (c == '"')
                in_string = false;
        }
        else if (c == '"')
            in_string = true;
        else if (c == '[' || c == '{')
        {
            if (++depth > MAX_DEPTH)
                return true;
        }
        else if ((c == ']' || c == '}') && depth > 0)
            depth--;
    }
    return false;
}

void hl_cmd_parse(const char *json, size_t len, hl_cmd *out)
{
    memset(out, 0, sizeof(*out));
    if (json != NULL && too_deep(json, len))
        return fail(out, "too deeply nested");
    const char *end = NULL;
    cJSON *root = (json != NULL && len > 0) ? cJSON_ParseWithLengthOpts(json, len, &end, false) : NULL;
    bool trailing = false;
    if (root != NULL)
    {
        // The parser stops after the first value; anything but whitespace or NUL after it is junk.
        for (const char *p = end; p < json + len; p++)
            if (*p != '\0' && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n')
                trailing = true;
    }
    const cJSON *name = root ? cJSON_GetObjectItemCaseSensitive(root, "command") : NULL;
    const char *command = cJSON_IsString(name) ? name->valuestring : NULL;

    if (root == NULL || !cJSON_IsObject(root))
        fail(out, "not a JSON object");
    else if (trailing)
        fail(out, "trailing bytes after the JSON");
    else if (command == NULL)
        fail(out, "missing command");
    else if (strcmp(command, "demand") == 0)
        demand(root, out);
    else if (strcmp(command, "set_schedule") == 0)
        set_schedule(root, out);
    else if (strcmp(command, "get_status") == 0)
        out->kind = HL_CMD_GET_STATUS;
    else if (strcmp(command, "reboot") == 0)
        out->kind = HL_CMD_REBOOT;
    else if (strcmp(command, "get_version") == 0 || strcmp(command, "ping") == 0 ||
             strcmp(command, "ota_update") == 0 || strcmp(command, "url_chunk") == 0 ||
             strcmp(command, "ota_cancel") == 0)
        out->kind = HL_CMD_FLEET;
    else
        fail(out, "unknown command");
    cJSON_Delete(root);
}
