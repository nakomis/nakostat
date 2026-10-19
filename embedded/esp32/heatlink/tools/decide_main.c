// hl-decide: run the heatlink's decision (port/heatlink.c) on scenarios from stdin, one JSON per line:
//
//   {"switch":"auto"|"on"|"off",
//    "demand":null | {"on":true,"source":"schedule","age_ms":12000,"ttl_s":300},
//    "now_ms":400000,                         monotonic, since boot (default 10 minutes)
//    "schedule":null | {set_schedule command},  parsed by hl_cmd_parse
//    "time_valid":true, "local":[wday, minute]}
//
// Prints {"mode":..,"relay":..,"source":..} per line, or {"error":..} for a bad scenario.
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "heatlink.h"
#include "hl_cmd.h"

static const char *decide(const cJSON *sc, hl_output *res)
{
    static hl_cmd cmd;
    hl_inputs in;
    memset(&in, 0, sizeof(in));
    in.now_ms = 600000;

    const cJSON *sw = cJSON_GetObjectItemCaseSensitive(sc, "switch");
    const char *s = cJSON_IsString(sw) ? sw->valuestring : "auto";
    in.sw = !strcmp(s, "on") ? HL_SW_ON : !strcmp(s, "off") ? HL_SW_OFF : HL_SW_AUTO;

    const cJSON *now = cJSON_GetObjectItemCaseSensitive(sc, "now_ms");
    if (cJSON_IsNumber(now))
        in.now_ms = (int64_t)now->valuedouble;

    const cJSON *d = cJSON_GetObjectItemCaseSensitive(sc, "demand");
    if (cJSON_IsObject(d))
    {
        const cJSON *on = cJSON_GetObjectItemCaseSensitive(d, "on");
        const cJSON *src = cJSON_GetObjectItemCaseSensitive(d, "source");
        const cJSON *age = cJSON_GetObjectItemCaseSensitive(d, "age_ms");
        const cJSON *ttl = cJSON_GetObjectItemCaseSensitive(d, "ttl_s");
        in.demand.have = true;
        in.demand.on = cJSON_IsTrue(on);
        in.demand.source = HL_SRC_SCHEDULE;
        if (cJSON_IsString(src) && !hl_demand_source_parse(src->valuestring, &in.demand.source))
            return "bad source";
        in.demand.received_ms = in.now_ms - (cJSON_IsNumber(age) ? (int64_t)age->valuedouble : 0);
        in.demand.ttl_s = hl_ttl_clamp(cJSON_IsNumber(ttl) ? ttl->valuedouble : HL_TTL_DEFAULT_S);
    }

    const cJSON *sched = cJSON_GetObjectItemCaseSensitive(sc, "schedule");
    if (cJSON_IsObject(sched))
    {
        char *text = cJSON_PrintUnformatted(sched);
        hl_cmd_parse(text, strlen(text), &cmd);
        cJSON_free(text);
        if (cmd.kind != HL_CMD_SET_SCHEDULE)
            return cmd.message;
        in.schedule = &cmd.schedule;
    }

    in.time_valid = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(sc, "time_valid"));
    const cJSON *local = cJSON_GetObjectItemCaseSensitive(sc, "local");
    if (cJSON_IsArray(local) && cJSON_GetArraySize(local) == 2)
    {
        in.local.wday = (uint8_t)cJSON_GetArrayItem(local, 0)->valuedouble;
        in.local.minute = (uint16_t)cJSON_GetArrayItem(local, 1)->valuedouble;
    }
    *res = hl_decide(&in);
    return NULL;
}

int main(void)
{
    static char line[64 * 1024];
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        cJSON *sc = cJSON_Parse(line);
        cJSON *out = cJSON_CreateObject();
        hl_output res;
        const char *err = sc ? decide(sc, &res) : "not JSON";
        if (err)
            cJSON_AddStringToObject(out, "error", err);
        else
        {
            cJSON_AddStringToObject(out, "mode", hl_mode_name(res.mode));
            cJSON_AddBoolToObject(out, "relay", res.relay);
            cJSON_AddStringToObject(out, "source", hl_source_name(res.source));
        }
        char *text = cJSON_PrintUnformatted(out);
        puts(text);
        fflush(stdout);
        cJSON_free(text);
        cJSON_Delete(out);
        cJSON_Delete(sc);
    }
    return 0;
}
