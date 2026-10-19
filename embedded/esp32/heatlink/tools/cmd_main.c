// hl-cmd: run the heatlink's own command parser (port/hl_cmd.c) from the command line.
//
//   hl-cmd [--now <epoch_s>]
//            one JSON command per line on stdin; one JSON result line each:
//            {"kind":"get_status"|"reboot"|"fleet"}
//            {"kind":"demand","on":..,"source":..,"ttl_s":..,"setpoint":<centi>|null,"temperature":<centi>|null,
//             "ts":<s>|null}  plus "too_old":bool (hl_demand_too_old against <epoch_s>) with --now
//            {"kind":"set_schedule","tz":..,"comfort":<centi>,"duty":..,"enabled":..,"days":[[[minute,centi],..],..]}
//            {"kind":"error","message":..}
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "hl_cmd.h"
#include "hl_time.h"

static const char *kind_name(hl_cmd_kind kind)
{
    switch (kind)
    {
    case HL_CMD_GET_STATUS:
        return "get_status";
    case HL_CMD_DEMAND:
        return "demand";
    case HL_CMD_SET_SCHEDULE:
        return "set_schedule";
    case HL_CMD_REBOOT:
        return "reboot";
    case HL_CMD_FLEET:
        return "fleet";
    case HL_CMD_ERROR:
        return "error";
    }
    return "?";
}

static void add_opt(cJSON *out, const char *name, bool has, int value)
{
    if (has)
        cJSON_AddNumberToObject(out, name, value);
    else
        cJSON_AddNullToObject(out, name);
}

int main(int argc, char *argv[])
{
    bool have_now = argc == 3 && strcmp(argv[1], "--now") == 0;
    long long now = have_now ? atoll(argv[2]) : 0;
    static char line[64 * 1024];
    static hl_cmd cmd;
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        size_t len = strcspn(line, "\r\n");  // an empty line is still a command: an error
        hl_cmd_parse(line, len, &cmd);
        cJSON *out = cJSON_CreateObject();
        cJSON_AddStringToObject(out, "kind", kind_name(cmd.kind));
        if (cmd.kind == HL_CMD_DEMAND)
        {
            cJSON_AddBoolToObject(out, "on", cmd.on);
            cJSON_AddStringToObject(out, "source", hl_source_name(cmd.source));
            cJSON_AddNumberToObject(out, "ttl_s", cmd.ttl_s);
            add_opt(out, "setpoint", cmd.has_setpoint, cmd.setpoint_centi);
            add_opt(out, "temperature", cmd.has_temperature, cmd.temperature_centi);
            if (cmd.has_ts)
                cJSON_AddNumberToObject(out, "ts", (double)cmd.ts);
            else
                cJSON_AddNullToObject(out, "ts");
            if (have_now)
                cJSON_AddBoolToObject(out, "too_old",
                                      hl_demand_too_old(cmd.has_ts, cmd.ts, hl_time_valid(now), now));
        }
        else if (cmd.kind == HL_CMD_SET_SCHEDULE)
        {
            const hl_schedule *s = &cmd.schedule;
            cJSON_AddStringToObject(out, "tz", s->tz);
            cJSON_AddNumberToObject(out, "comfort", s->comfort_centi);
            cJSON_AddNumberToObject(out, "duty", s->duty_pct);
            cJSON_AddBoolToObject(out, "enabled", s->enabled);
            cJSON_AddBoolToObject(out, "valid", hl_schedule_valid(s));
            cJSON *days = cJSON_AddArrayToObject(out, "days");
            for (int d = 0; d < HL_DAYS; d++)
            {
                cJSON *day = cJSON_CreateArray();
                for (int i = 0; i < s->count[d]; i++)
                {
                    cJSON *e = cJSON_CreateArray();
                    cJSON_AddItemToArray(e, cJSON_CreateNumber(s->entry[d][i].minute));
                    cJSON_AddItemToArray(e, cJSON_CreateNumber(s->entry[d][i].target_centi));
                    cJSON_AddItemToArray(day, e);
                }
                cJSON_AddItemToArray(days, day);
            }
        }
        else if (cmd.kind == HL_CMD_ERROR)
            cJSON_AddStringToObject(out, "message", cmd.message);
        char *text = cJSON_PrintUnformatted(out);
        puts(text);
        fflush(stdout);
        cJSON_free(text);
        cJSON_Delete(out);
    }
    return 0;
}
