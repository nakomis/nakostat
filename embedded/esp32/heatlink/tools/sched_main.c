// hl-sched: evaluate a schedule (port/schedule.c) from the command line.
//
//   hl-sched              one JSON per line on stdin:
//                           {"schedule":{set_schedule command},"at":[[wday,minute],...]}
//                         prints {"target":[<centi>|null,...],"heat":[bool,...]} or {"error":..}
//   hl-sched --duty <pct> prints the minutes of each hour the fallback heats
//   hl-sched --valid      one JSON per line: a raw schedule (as hl_schedule's fields:
//                         {"count":[..7],"entries":[[[m,c],..],..],"comfort":c,"duty":p,"tz":".."});
//                         prints 1 or 0 from hl_schedule_valid
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "hl_cmd.h"
#include "schedule.h"

static void print(cJSON *out)
{
    char *text = cJSON_PrintUnformatted(out);
    puts(text);
    fflush(stdout);
    cJSON_free(text);
    cJSON_Delete(out);
}

static int num(const cJSON *obj, const char *name, int dflt)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, name);
    return cJSON_IsNumber(item) ? (int)item->valuedouble : dflt;
}

static void valid(const cJSON *raw)
{
    hl_schedule s;
    hl_schedule_init(&s);
    const cJSON *count = cJSON_GetObjectItemCaseSensitive(raw, "count");
    const cJSON *entries = cJSON_GetObjectItemCaseSensitive(raw, "entries");
    for (int d = 0; d < HL_DAYS; d++)
    {
        const cJSON *c = cJSON_GetArrayItem(count, d);
        s.count[d] = (uint8_t)(cJSON_IsNumber(c) ? c->valuedouble : 0);
        const cJSON *day = cJSON_GetArrayItem(entries, d);
        for (int i = 0; i < HL_MAX_ENTRIES && i < cJSON_GetArraySize(day); i++)
        {
            const cJSON *e = cJSON_GetArrayItem(day, i);
            s.entry[d][i].minute = (uint16_t)cJSON_GetArrayItem(e, 0)->valuedouble;
            s.entry[d][i].target_centi = (int16_t)cJSON_GetArrayItem(e, 1)->valuedouble;
        }
    }
    s.comfort_centi = (int16_t)num(raw, "comfort", s.comfort_centi);
    s.duty_pct = (uint8_t)num(raw, "duty", s.duty_pct);
    const cJSON *tz = cJSON_GetObjectItemCaseSensitive(raw, "tz");
    if (cJSON_IsString(tz))
        snprintf(s.tz, sizeof(s.tz), "%s", tz->valuestring);
    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(raw, "unterminated_tz")))
        memset(s.tz, 'A', sizeof(s.tz));
    printf("%d\n", hl_schedule_valid(&s));
    fflush(stdout);
}

int main(int argc, char *argv[])
{
    if (argc == 3 && strcmp(argv[1], "--duty") == 0)
    {
        printf("%d\n", hl_duty_minutes((uint8_t)atoi(argv[2])));
        return 0;
    }
    bool check = argc == 2 && strcmp(argv[1], "--valid") == 0;
    static char line[64 * 1024];
    static hl_cmd cmd;
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        cJSON *in = cJSON_Parse(line);
        if (check)
        {
            valid(in);
            cJSON_Delete(in);
            continue;
        }
        cJSON *out = cJSON_CreateObject();
        const cJSON *sched = cJSON_GetObjectItemCaseSensitive(in, "schedule");
        char *text = sched ? cJSON_PrintUnformatted(sched) : NULL;
        if (text)
            hl_cmd_parse(text, strlen(text), &cmd);
        cJSON_free(text);
        if (!text || cmd.kind != HL_CMD_SET_SCHEDULE)
        {
            cJSON_AddStringToObject(out, "error", text ? cmd.message : "no schedule");
            print(out);
            cJSON_Delete(in);
            continue;
        }
        cJSON *targets = cJSON_AddArrayToObject(out, "target");
        cJSON *heats = cJSON_AddArrayToObject(out, "heat");
        const cJSON *at;
        cJSON_ArrayForEach(at, cJSON_GetObjectItemCaseSensitive(in, "at"))
        {
            hl_local local = {(uint8_t)cJSON_GetArrayItem(at, 0)->valuedouble,
                              (uint16_t)cJSON_GetArrayItem(at, 1)->valuedouble};
            int16_t t;
            if (hl_schedule_target(&cmd.schedule, local, &t))
                cJSON_AddItemToArray(targets, cJSON_CreateNumber(t));
            else
                cJSON_AddItemToArray(targets, cJSON_CreateNull());
            cJSON_AddItemToArray(heats, cJSON_CreateBool(hl_fallback_heat(&cmd.schedule, local)));
        }
        print(out);
        cJSON_Delete(in);
    }
    return 0;
}
