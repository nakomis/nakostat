# Heatlink firmware

The heatlink is the box at the boiler: an ESP32-S3 that switches the boiler's `ROOM STAT/TIMER`
input through a relay. The Pi daemon is the brain. The heatlink follows the daemon's `demand`, obeys
the 3-way switch, and falls back to a local copy of the schedule when the daemon goes quiet.

- Design (binding contracts): [`docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md`](../../../docs/superpowers/specs/2026-10-19-heatlink-v2-prototype-design.md)
- Plane: STAT-70 (epic STAT-69)
- ESP-IDF 5.5, ESP32-S3, 4 MB partition table, no PSRAM, 160 MHz. The IDF project name, Fleet
  project and S3 prefix are all `nakostat`. The version lives in `esp32s3/version.txt`.

## Layout

```
heatlink/
├── CMakeLists.txt     # host build: hl_port (port/*.c) + one driver hl-<name> per tools/<name>_main.c
├── port/              # portable C, built for the host tests and compiled into the image
│   ├── heatlink.c     #   the decision table (switch × demand × schedule × clock → mode + relay)
│   ├── schedule.c     #   the local schedule and the fallback duty cycle
│   ├── hl_time.c      #   POSIX TZ → local weekday and minute
│   ├── switch_in.c    #   switch reading and 50 ms debounce
│   ├── led.c          #   status LED colours
│   ├── hl_cmd.c       #   demand / set_schedule / get_status / reboot
│   ├── ota_cmd.c      #   Fleet's commands (copied unchanged from kappa-warmer)
│   └── status_json.c  #   the /status JSON
├── tools/             # host test drivers (<name>_main.c → build/hl-<name>)
├── tests/             # pytest: conftest.py builds the drivers, tool(name) runs one
├── scripts/provision-device.sh
└── esp32s3/           # the IDF project: main/, partitions.csv, sdkconfig.defaults, scripts/
```

## GPIO map (ESP32-S3-DevKitC-1 N16R8)

| Signal | GPIO | Kconfig | Notes |
|---|---|---|---|
| Relay IN | 4 | `HEATLINK_RELAY_GPIO` | `HEATLINK_RELAY_ACTIVE_LOW` (default y): driven **open-drain**, low = on, released = off through the module's pull-up. Works with a 3.3 V or 5 V module, and the relay is off while the pin floats at boot. Say n for an active-high module (push-pull). |
| Switch "on" throw | 5 | `HEATLINK_SWITCH_ON_GPIO` | Internal pull-up; the switch's common goes to GND |
| Switch "off" throw | 6 | `HEATLINK_SWITCH_OFF_GPIO` | Internal pull-up; centre position (neither throw) = **auto** |
| RGB status LED | 48 | `HEATLINK_LED_GPIO` | The DevKitC's onboard WS2812. **v1.1 boards use 38**: set it in `idf.py menuconfig` |

Avoided: GPIO 35–37 (octal PSRAM), straps 0, 3, 45, 46, USB 19/20 and UART0 43/44. Both throws
grounded at once can't happen with a working centre-off switch; it reads as **off**.

Power: a 5 V USB charger into the DevKitC. The relay module's VCC is the DevKitC's 5 V pin, its GND
to GND, its IN to GPIO 4.

## Status LED

| Colour | Meaning |
|---|---|
| purple | forced on or off by the switch |
| orange | relay on (auto or fallback) |
| blue | fallback, relay off |
| green | auto, idle |
| red, blinking | no Wi-Fi or no IoT Core connection: alternates every 500 ms with the colour above |

Brightness: `HEATLINK_LED_LEVEL` (default 40 of 255).

## Behaviour

| Switch | Condition | Mode | Relay |
|---|---|---|---|
| on | any | `force_on` | on |
| off | any | `force_off` | off |
| auto | demand younger than its `ttl_s` | `auto` | the demand's `on` |
| auto | no demand since boot, within the first 300 s | `auto` | off (cold boot) |
| auto | demand stale, schedule known, clock valid | `fallback` | the schedule's duty cycle |
| auto | demand stale, no schedule or no valid clock | `fallback` | off |

**Fallback** heats while the schedule's target at local time is at least `comfort_c` (default
18 °C), for `duty_pct` (default 67%) of each **clock hour**: minutes 0–39 on, 40–59 off. The target
in force is the most recent entry at-or-before now, searching backwards around the week, as in the
daemon. An empty day holds the previous day's last target. The clock is valid once SNTP has set it
(after 2025-01-01). Local time comes from the schedule's POSIX `tz` (default Europe/London,
`GMT0BST,M3.5.0/1,M10.5.0`).

The switch is polled every 20 ms. A new position counts once it has read the same for 50 ms. The
first reading at boot counts at once, so a forced switch takes effect at power-up.

## Commands, status and storage

Commands arrive on `nakostat/<thing>/commands` as `{"command": ...}`. The Thing name comes from the
prov partition (default `nakostat-heatlink`).

- `demand` `{"on":true,"source":"schedule"|"override"|"frost"|"off","setpoint":20.5,"temperature":19.8,"ttl_s":300}`:
  `on` is required. `source` defaults to `override`. `ttl_s` defaults to 300 and is clamped to
  60–1800. A successful demand gets **no reply**, because the daemon sends one every 30 s; `/status`
  shows the effect.
- `set_schedule` `{"tz":..,"comfort_c":18.0,"duty_pct":67,"days":[[[360,20.0],[540,16.0]],…7 days, Monday first]}`:
  - `days` must hold exactly 7 days, each with at most 8 `[minute 0–1439, target_c]` entries.
  - Entries are sorted; at the same minute the later entry wins.
  - Targets are clamped to 0–30 °C, `comfort_c` to 5–30 °C, and `duty_pct` to 0–100.
  - The heatlink answers `set_schedule_result` `ok` with the message `stored`, or `unchanged` if
    the schedule is the same; an unchanged schedule isn't rewritten to flash.
- `get_status`: publishes a status with `reason:"request"` on `/status`.
- `reboot`: answers `reboot_result`, then restarts.
- Fleet's own `get_version`, `ping`, `ota_update`, `url_chunk`, `ota_cancel`, with kappa-warmer's
  message shapes (`version`, `pong`, `ota_progress`, `ota_error`, `ota_complete` on `/responses`).
- Anything malformed or unknown: `{"type":"error","message":"unknown command"}` (or what was wrong)
  on `/responses`.

`/status` is published every 60 s (`heartbeat`), immediately when `mode` or `relay` changes
(`change`), and after every MQTT connect (`boot` the first time):

```json
{"mode":"auto","relay":true,"switch":"auto","source":"schedule","demand_age_s":12,"schedule_known":true,
 "time_valid":true,"rssi":-61,"uptime_s":3600,"reason":"heartbeat","version":"0.1.0"}
```

`demand_age_s` and `rssi` are `null` when unknown.

Storage:
- `nvs`, namespace `heatlink`: `schedule` (a versioned blob, checked on load). Namespace `ota`:
  `target` and `target_slot`, for the rollback check.
- `prov` (NVS partition, namespace `nakostat`): Wi-Fi, IoT endpoint, Thing name, certificate and key.

OTA is unsigned for the prototype (Fleet capability `ota`). A new image is on probation until MQTT
is subscribed to `/commands` (SUBACK granted). If that doesn't happen within 120 s, the bootloader
rolls back to the old image.

## Host tests

```bash
brew install cjson cmake                    # once
python3 -m venv embedded/esp32/heatlink/venv
embedded/esp32/heatlink/venv/bin/pip install -r embedded/esp32/heatlink/tests/requirements.txt
embedded/esp32/heatlink/venv/bin/python -m pytest -q embedded/esp32/heatlink/tests   # builds build/ itself
```

To build the drivers by hand: `cmake -S embedded/esp32/heatlink -B embedded/esp32/heatlink/build &&
cmake --build embedded/esp32/heatlink/build`.

## Image build

```bash
. ~/esp/v5.5/esp-idf/export.sh
cd embedded/esp32/heatlink/esp32s3 && idf.py set-target esp32s3 build
```

The app is about 1.0 MB in a 1.875 MB slot (about 53%).

## Provision and flash (Martin)

1. Deploy the IotStack (it creates the Thing `nakostat-heatlink` and the policy
   `nakostat-heatlink-policy-<env>`).
2. Provision. This makes the certificate with the AWS CLI and writes
   `esp32s3/certs/nakostat-heatlink/prov.bin`, which is git-ignored and holds the Wi-Fi password and
   private key:
   ```bash
   AWS_PROFILE=nakom.is-sandbox NPM_ENVIRONMENT=sandbox embedded/esp32/heatlink/scripts/provision-device.sh
   ```
3. Flash over the DevKitC's **UART** port. This writes the bootloader, partition table, OTA data,
   the app and `prov`, but never `nvs`, so the stored schedule survives:
   ```bash
   embedded/esp32/heatlink/esp32s3/scripts/flash-manual.sh /dev/cu.usbserial-XXXX
   ```
   If auto-reset fails: hold BOOT, tap RST, release BOOT, then run it again.
4. Watch the log: `idf.py -p /dev/cu.usbserial-XXXX monitor`.

After that, Fleet updates it over the air. CI publishes each build with `esp32s3/scripts/ci-publish.sh`
to `s3://nakomis-firmware-{env}/nakostat/<version>/firmware.bin`.

## Bench test (no mains)

The breadboard **never carries mains**. On the bench the relay switches an LED as a dummy load.

Wiring: relay module VCC → 5V, GND → GND, IN → GPIO 4. Switch common → GND, throws → GPIO 5 (on)
and GPIO 6 (off). Dummy load: 3.3 V → 1 kΩ → LED → relay COM, relay NO → GND. The LED lights when
the relay closes.

1. **Cold boot, offline.** Before provisioning (`idf.py -p <port> flash`, which leaves `prov`
   empty), or with the router off. Switch in
   the centre. The status LED blinks red/green, the relay stays off, and the log says "not
   provisioned" (or keeps retrying Wi-Fi).
2. **Switch.** Move to "on": within about 50 ms the relay clicks, the dummy LED lights and the
   status LED shows purple (blinking with red while offline). Move to "off": the relay opens, still
   purple. Back to the centre: auto. Flick the switch quickly: bounces shorter than 50 ms are
   ignored.
3. **Provisioned, online.** The status LED stops blinking red. In Fleet (or the IoT console's MQTT
   test client), subscribe to `nakostat/nakostat-heatlink/#` and look for a `boot` status, then a
   `heartbeat` every 60 s.
4. **Demand.** Publish to `nakostat/nakostat-heatlink/commands`:
   `{"command":"demand","on":true,"source":"override","ttl_s":60}`. The relay closes, the status
   LED turns orange, and a `change` status arrives with `"source":"override"`. Send `"on":false`:
   the relay opens and the LED turns green.
5. **Watchdog and fallback.** Send `{"command":"demand","on":true,"ttl_s":60}` and then nothing more.
   After 60 s the mode becomes `fallback` (`change` status) and the LED turns blue; with no schedule
   the relay is off.
6. **Fallback schedule.** Send a schedule that heats now, e.g. every day `[[0, 20.0]]`:
   `{"command":"set_schedule","days":[[[0,20]],[[0,20]],[[0,20]],[[0,20]],[[0,20]],[[0,20]],[[0,20]]]}`.
   You get `set_schedule_result ok stored`. In fallback the relay closes during minutes 0–39 of the
   hour and opens for 40–59. Reboot (`{"command":"reboot"}`): `schedule_known` is still `true`.
7. **Cold boot with a schedule.** Power-cycle. For the first 300 s the relay stays off (mode `auto`,
   source `off`), then fallback takes over.
8. **OTA.** From Fleet, update to a newer published version. You see `ota_progress` and then a
   restart; the new version reports `ota_complete` once it is subscribed.

Only after all of this passes, and after a qualified person has checked it, does the relay go on
the boiler. See the spec's *Mains and safety* section.
