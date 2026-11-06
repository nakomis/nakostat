// Relay, switch and status LED. See io.h.
#include "io.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "led_strip.h"
#include "sdkconfig.h"
#include "switch_in.h"

static const char *TAG = "io";

static const hl_board *board;  // NULL: no board this image knows, so no pin is touched
static int relay_on_level;
static led_strip_handle_t strip;
static int shown = -1;  // the colour on the LED, or -1 before the first write

void io_init(const hl_board *b)
{
    board = b;
    if (board == NULL)
    {
        ESP_LOGE(TAG, "unknown board: the relay, switch and LED are left alone (relay off)");
        return;
    }
    // Active-low is open-drain: released (high-Z) = off, through the module's pull-up.
    relay_on_level = board->relay_active_low ? 0 : 1;

    // Off is latched into the output register before the pin becomes an output, so it never
    // glitches on.
    gpio_set_level(board->relay, !relay_on_level);
    const gpio_config_t relay = {
        .pin_bit_mask = 1ULL << board->relay,
        .mode = board->relay_active_low ? GPIO_MODE_OUTPUT_OD : GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&relay));
    gpio_set_level(board->relay, !relay_on_level);

    const gpio_config_t sw = {
        .pin_bit_mask = (1ULL << board->sw_on) | (1ULL << board->sw_off),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&sw));

    const led_strip_config_t strip_config = {
        .strip_gpio_num = board->led,
        .max_leds = 1,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
    };
    const led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
    };
    esp_err_t err = led_strip_new_rmt_device(&strip_config, &rmt_config, &strip);
    if (err != ESP_OK)
    {
        ESP_LOGE(TAG, "status LED unavailable (%s)", esp_err_to_name(err));
        strip = NULL;
    }
    ESP_LOGI(TAG, "board %s: relay GPIO %d (%s), switch on/off GPIO %d/%d, LED GPIO %d", board->name,
             board->relay, board->relay_active_low ? "active-low, open-drain" : "active-high, push-pull",
             board->sw_on, board->sw_off, board->led);
}

void io_set_relay(bool on)
{
    if (board != NULL)
        gpio_set_level(board->relay, on ? relay_on_level : !relay_on_level);
}

hl_switch io_read_switch(void)
{
    if (board == NULL)
        return HL_SW_AUTO;
    return hl_switch_from_pins(gpio_get_level(board->sw_on) == 0, gpio_get_level(board->sw_off) == 0);
}

void io_set_led(hl_led colour)
{
    if (strip == NULL || (int)colour == shown)
        return;
    uint8_t r, g, b;
    hl_led_rgb(colour, CONFIG_HEATLINK_LED_LEVEL, &r, &g, &b);
    if (led_strip_set_pixel(strip, 0, r, g, b) == ESP_OK && led_strip_refresh(strip) == ESP_OK)
        shown = (int)colour;
}
