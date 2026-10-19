// Relay, switch and status LED. See io.h.
#include "io.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "led_strip.h"
#include "sdkconfig.h"
#include "switch_in.h"

static const char *TAG = "io";

#define RELAY CONFIG_HEATLINK_RELAY_GPIO
#define SW_ON CONFIG_HEATLINK_SWITCH_ON_GPIO
#define SW_OFF CONFIG_HEATLINK_SWITCH_OFF_GPIO

#ifdef CONFIG_HEATLINK_RELAY_ACTIVE_LOW
#define RELAY_ON_LEVEL 0
#define RELAY_MODE GPIO_MODE_OUTPUT_OD  // released (high-Z) = off, through the module's pull-up
#else
#define RELAY_ON_LEVEL 1
#define RELAY_MODE GPIO_MODE_OUTPUT
#endif

static led_strip_handle_t strip;
static int shown = -1;  // the colour on the LED, or -1 before the first write

void io_init(void)
{
    // Off is latched into the output register before the pin becomes an output, so it never
    // glitches on.
    gpio_set_level(RELAY, !RELAY_ON_LEVEL);
    const gpio_config_t relay = {
        .pin_bit_mask = 1ULL << RELAY,
        .mode = RELAY_MODE,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&relay));
    gpio_set_level(RELAY, !RELAY_ON_LEVEL);

    const gpio_config_t sw = {
        .pin_bit_mask = (1ULL << SW_ON) | (1ULL << SW_OFF),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&sw));

    const led_strip_config_t strip_config = {
        .strip_gpio_num = CONFIG_HEATLINK_LED_GPIO,
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
    ESP_LOGI(TAG, "relay GPIO %d (%s), switch on/off GPIO %d/%d, LED GPIO %d", RELAY,
             RELAY_ON_LEVEL ? "active-high, push-pull" : "active-low, open-drain", SW_ON, SW_OFF,
             CONFIG_HEATLINK_LED_GPIO);
}

void io_set_relay(bool on)
{
    gpio_set_level(RELAY, on ? RELAY_ON_LEVEL : !RELAY_ON_LEVEL);
}

hl_switch io_read_switch(void)
{
    return hl_switch_from_pins(gpio_get_level(SW_ON) == 0, gpio_get_level(SW_OFF) == 0);
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
