# Host build of the heatlink's portable code, for the tests
# (python -m pytest -q embedded/esp32/heatlink/tests). The ESP32-S3 image is built from esp32s3/
# with idf.py; it compiles the same port/ sources.
#
#   cmake -S embedded/esp32/heatlink -B embedded/esp32/heatlink/build
#   cmake --build embedded/esp32/heatlink/build
#
# Every port/*.c joins hl_port, and every tools/<name>_main.c becomes the driver hl-<name>, so a
# new module is just its files.
cmake_minimum_required(VERSION 3.20)
project(heatlink_host C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(PkgConfig REQUIRED)
# cJSON for the command parsers; ESP-IDF has its own (the json component).
pkg_check_modules(CJSON REQUIRED IMPORTED_TARGET libcjson)

file(GLOB HL_PORT_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/port/*.c)
add_library(hl_port STATIC ${HL_PORT_SOURCES})
target_include_directories(hl_port PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/port)
target_link_libraries(hl_port PUBLIC PkgConfig::CJSON m)
target_compile_options(hl_port PRIVATE -Wall -Wextra -Werror)

file(GLOB HL_DRIVERS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tools/*_main.c)
foreach(driver ${HL_DRIVERS})
  get_filename_component(stem ${driver} NAME_WE)
  string(REGEX REPLACE "_main$" "" stem ${stem})
  add_executable(hl-${stem} ${driver})
  target_link_libraries(hl-${stem} PRIVATE hl_port)
  target_compile_options(hl-${stem} PRIVATE -Wall -Wextra -Werror)
endforeach()
