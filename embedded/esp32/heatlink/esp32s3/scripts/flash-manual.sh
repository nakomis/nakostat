#!/usr/bin/env bash
# Flash the heatlink over USB: the first image, and any time OTA can't be used.
#
#   embedded/esp32/heatlink/esp32s3/scripts/flash-manual.sh /dev/cu.usbserial-XXXX [thing]
#
# Use the DevKitC-1's UART port (the one marked UART, not USB). If auto-reset doesn't work (e.g. a
# CH343 on macOS), put the board in download mode first: hold BOOT, tap RST, release BOOT.
# Afterwards a watchdog reset starts the new firmware, so no RST tap is needed.
#
# Writes the bootloader, partition table, OTA data and the app from build/ (idf.py build; OTA is
# unsigned), plus the device's prov partition from certs/<thing>/prov.bin
# (scripts/provision-device.sh; the only one there if no thing is named). Never the nvs partition:
# the stored schedule survives. Writing OTA data boots ota_0, whichever slot an update had moved to.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
[ $# -ge 1 ] || { echo "usage: flash-manual.sh <port> [thing]" >&2; exit 2; }
[ -d "$here/build" ] && [ -f "$here/build/flash_args" ] || { echo "no build/flash_args: run idf.py build first" >&2; exit 1; }
cd "$here/build"
IDF_PATH="${IDF_PATH:-$HOME/esp/v5.5/esp-idf}"
# shellcheck disable=SC1091
. "$IDF_PATH/export.sh" > /dev/null

prov=()
if [ -n "${2:-}" ]; then
    prov=("$here/certs/$2/prov.bin")
else
    shopt -s nullglob
    prov=("$here"/certs/*/prov.bin)
fi
if [ "${#prov[@]}" -ne 1 ] || [ ! -s "${prov[0]}" ]; then
    echo "need exactly one prov.bin (have ${#prov[@]}): name the thing, or run embedded/esp32/heatlink/scripts/provision-device.sh" >&2
    exit 1
fi
offset=$(awk -F', *' '$1 == "prov" { print $4 }' "$here/partitions.csv")
echo "prov: ${prov[0]} at ${offset}"
python -m esptool --chip esp32s3 -p "$1" -b 460800 --before default_reset --after watchdog_reset write_flash @flash_args \
    "$offset" "${prov[0]}"
