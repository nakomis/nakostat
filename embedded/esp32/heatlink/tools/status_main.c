// hl-status: build /status JSON (port/status_json.c) from a JSON view per line on stdin:
//
//   {"mode":"auto","relay":true,"switch":"auto","source":"schedule","demand_age_s":12|null,
//    "schedule_known":true,"time_valid":true,"rssi":-61|null,"uptime_s":3600,"reason":"heartbeat",
//    "version":"0.1.0"|null, "_bufsize":4096}
//
// Missing fields take the zero view (auto, off, auto, schedule, ...). Prints the JSON, or ERR if it
// doesn't fit _bufsize.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "status_json.h"

static const char *str(const cJSON *v, const char *name)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(v, name);
    return cJSON_IsString(item) ? item->valuestring : "";
}

int main(void)
{
    static char line[16 * 1024];
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        cJSON *in = cJSON_Parse(line);
        hl_status v;
        memset(&v, 0, sizeof(v));
        for (hl_mode m = HL_MODE_AUTO; m <= HL_MODE_FORCE_OFF; m++)
            if (!strcmp(str(in, "mode"), hl_mode_name(m)))
                v.mode = m;
        for (hl_switch s = HL_SW_AUTO; s <= HL_SW_OFF; s++)
            if (!strcmp(str(in, "switch"), hl_switch_name(s)))
                v.sw = s;
        for (hl_source s = HL_SRC_SCHEDULE; s <= HL_SRC_SWITCH; s++)
            if (!strcmp(str(in, "source"), hl_source_name(s)))
                v.source = s;
        for (hl_reason r = HL_REASON_BOOT; r <= HL_REASON_REQUEST; r++)
            if (!strcmp(str(in, "reason"), hl_reason_name(r)))
                v.reason = r;
        v.relay = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(in, "relay"));
        v.schedule_known = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(in, "schedule_known"));
        v.time_valid = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(in, "time_valid"));
        const cJSON *age = cJSON_GetObjectItemCaseSensitive(in, "demand_age_s");
        v.have_demand = cJSON_IsNumber(age);
        v.demand_age_s = v.have_demand ? (uint32_t)age->valuedouble : 0;
        const cJSON *rssi = cJSON_GetObjectItemCaseSensitive(in, "rssi");
        v.have_rssi = cJSON_IsNumber(rssi);
        v.rssi = v.have_rssi ? (int)rssi->valuedouble : 0;
        const cJSON *up = cJSON_GetObjectItemCaseSensitive(in, "uptime_s");
        v.uptime_s = cJSON_IsNumber(up) ? (uint32_t)up->valuedouble : 0;
        const cJSON *ver = cJSON_GetObjectItemCaseSensitive(in, "version");
        v.version = cJSON_IsString(ver) ? ver->valuestring : NULL;
        const cJSON *size = cJSON_GetObjectItemCaseSensitive(in, "_bufsize");
        size_t cap = cJSON_IsNumber(size) ? (size_t)size->valuedouble : 4096;
        char *buf = malloc(cap ? cap : 1);
        if (hl_status_json(buf, cap, &v) < 0)
            puts("ERR");
        else
            puts(buf);
        fflush(stdout);
        free(buf);
        cJSON_Delete(in);
    }
    return 0;
}
