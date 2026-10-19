# Nakostat heatlink firmware for the ESP32-S3: the boiler relay, the 3-way switch and the status
# LED, a fallback schedule for when the Pi goes quiet, and Fleet over MQTT (status, commands, OTA).
#
#   . ~/esp/v5.5/esp-idf/export.sh
#   idf.py set-target esp32s3 build
#
# The version is esp32s3/version.txt: IDF reads it into PROJECT_VER (and so esp_app_desc).
cmake_minimum_required(VERSION 3.16)

set(IDF_TARGET esp32s3)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
# The project name is the app's esp_app_desc project_name: the OTA check compares it with
# "nakostat" (Fleet's project and the S3 prefix), so it must not change.
project(nakostat)
