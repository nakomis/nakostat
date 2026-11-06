// Nakostat heatlink: the application starts here. Boot order: NVS, the board, OTA probation, the
// app (relay off, switch, stored schedule), then the network.
#include <stdbool.h>
#include <stdlib.h>

#include "app.h"
#include "board.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"
#include "nvs_flash.h"
#include "ota.h"
#include "prov.h"

static const char *TAG = "nakostat";

static prov_t prov;

// A new image from an update that can't run here goes back to the old one (and reboots); any other
// image returns.
static void roll_back_if_on_probation(void)
{
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY)
        esp_ota_mark_app_invalid_rollback_and_reboot();
}

void app_main(void)
{
    const esp_app_desc_t *desc = esp_app_get_description();
    ESP_LOGI(TAG, "%s %s (heatlink)", desc->project_name, desc->version);

    // Never erase NVS to get past an error: it holds the schedule. An image that can't read it
    // stops here and, if it is a new one from an update, goes back to the old one. The relay GPIO
    // is still unconfigured here, so the relay is off.
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK)
    {
        ESP_LOGE(TAG, "NVS unusable (%s): not erasing it", esp_err_to_name(err));
        roll_back_if_on_probation();
        abort();
    }

    // The pins come from the board this heatlink was provisioned as (board.h). A board this image
    // doesn't know (provisioned for a newer one) gets the old image back; with nothing to go back
    // to it runs with the relay off, and says so in its status.
    char name[16];
    prov_board(name, sizeof(name));
    const hl_board *board = hl_board_find(name);
    if (board == NULL)
    {
        ESP_LOGE(TAG, "provisioned as board \"%s\", which this image doesn't know", name);
        roll_back_if_on_probation();
    }

    ota_boot();
    app_start(board);

    if (prov_load(&prov))
        net_start(&prov, app_on_command);
    else
        ESP_LOGE(TAG, "not provisioned: no network, no updates; the switch and relay still work");

    for (;;)
        vTaskDelay(pdMS_TO_TICKS(60000));
}
