# The portable code in ../../port (pure C, host-tested) joins the image here.
file(GLOB PORT_SOURCES ${COMPONENT_DIR}/../../port/*.c)

idf_component_register(
  SRCS main.c app.c io.c prov.c net.c ota.c ${PORT_SOURCES}
  INCLUDE_DIRS "." ${COMPONENT_DIR}/../../port
  PRIV_REQUIRES nvs_flash esp_timer app_update esp_app_format esp_wifi esp_netif esp_event mqtt json
                esp_http_client mbedtls esp_driver_gpio
  # Amazon Root CA 1 (public) for IoT Core and the OTA download. The heatlink's own certificate,
  # key and settings are not in the image: they're in the prov partition (prov.h).
  EMBED_TXTFILES ${COMPONENT_DIR}/../AmazonRootCA1.pem
)
