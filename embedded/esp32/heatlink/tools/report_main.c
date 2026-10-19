// hl-report: drive the status reporter (port/report.c) one loop per line on stdin, keeping state:
//
//   {"now":ms,"mqtt":bool,"changed":bool,"acked":bool,"ok":bool}
//       hl_report_due; when it says publish, hl_report_sent with ok (default true).
//   {"request":true,"now":ms,"ok":bool}
//       a get_status publish: hl_report_sent(request).
//
// Prints {"publish":"boot"|"heartbeat"|"change"|"request"|null} per line.
#include <stdio.h>

#include "cJSON.h"
#include "report.h"

static bool flag(const cJSON *in, const char *name, bool dflt)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(in, name);
    return cJSON_IsBool(item) ? cJSON_IsTrue(item) : dflt;
}

int main(void)
{
    static char line[4096];
    hl_reporter r;
    hl_report_init(&r);
    while (fgets(line, sizeof(line), stdin) != NULL)
    {
        cJSON *in = cJSON_Parse(line);
        const cJSON *now_item = cJSON_GetObjectItemCaseSensitive(in, "now");
        int64_t now = cJSON_IsNumber(now_item) ? (int64_t)now_item->valuedouble : 0;
        bool ok = flag(in, "ok", true);
        const char *published = NULL;
        hl_reason reason;
        if (flag(in, "request", false))
        {
            hl_report_sent(&r, now, HL_REASON_REQUEST, ok);
            published = hl_reason_name(HL_REASON_REQUEST);
        }
        else if (hl_report_due(&r, now, flag(in, "mqtt", true), flag(in, "changed", false),
                               flag(in, "acked", false), &reason))
        {
            hl_report_sent(&r, now, reason, ok);
            published = hl_reason_name(reason);
        }
        cJSON *out = cJSON_CreateObject();
        if (published)
            cJSON_AddStringToObject(out, "publish", published);
        else
            cJSON_AddNullToObject(out, "publish");
        char *text = cJSON_PrintUnformatted(out);
        puts(text);
        fflush(stdout);
        cJSON_free(text);
        cJSON_Delete(out);
        cJSON_Delete(in);
    }
    return 0;
}
