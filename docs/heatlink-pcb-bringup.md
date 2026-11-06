# Heatlink PCB bring-up

STAT-82, for the STAT-75 board (`pcb/heatlink`, board `pcb-v1`). This takes an assembled board from
PCBWay to a heatlink that passes the bench check, **without mains**. Mains only goes on after the board
passes, and after a qualified person has checked the installation. That part follows the live-trial
steps in [`heatlink-prototype-wiring.md`](heatlink-prototype-wiring.md), with J2 in place of the relay
module's COM/NO.

What each part does: [`heatlink-board-key.md`](heatlink-board-key.md).

**You'll need:**
- the house USB cable (JST SH 5-pin, tinycrypt's);
- a USB power meter;
- a multimeter;
- the venv with `bench/requirements.txt` installed ([`bench/README.md`](../embedded/esp32/heatlink/bench/README.md)).

Note the results as you go. The bench check writes its own report.

## 1. Look (unpowered)

| Check | Expect |
|---|---|
| Every part present, nothing tombstoned, no solder bridges on U1's castellations or U3's pins | The key's photo |
| D2 (TVS) and D3 (flyback) the right way round | The cathode bands match the silkscreen |
| D1 (LED), U3, Q1, U2 orientation | Pin 1 / chamfer matches the silkscreen |
| J2's openings face the gland end | |

## 2. Measure (unpowered)

On J3, the 8-way terminal (5V, G, 3V3, …), and on J2:

| Check | Expect | If not |
|---|---|---|
| 5V to G | Not a short. It may climb slowly as the capacitors charge | A short: D2 fitted backwards, or a bridge. Don't power it |
| 3V3 to G | Not a short | A bridge at U2, U1 or the decoupling |
| J2 terminal to terminal | Open (OL): the relay is off | K1 is faulty or the wrong part |
| Either J2 terminal to G, 5V or 3V3 | Open (OL) on the meter's highest range | Stop: the mains side reaches the low-voltage side |

## 3. First power

Plug the board into the Mac through the USB power meter. A new module's flash may be blank. It may
also already hold PCBWay's test firmware. Either way:

| Check | Expect | If not |
|---|---|---|
| Current | Under about 100 mA before our firmware runs | Over 200 mA: unplug at once and look for heat (U2, Q1, D2) |
| 5V on J3 | 4.8–5.2 V | Low: F1 tripping, or the cable or port |
| 3V3 on J3 | 3.25–3.35 V | U2 or a load fault |
| J2 | Still open: the relay stays off at power-up (R8 holds Q1's gate low) | **Stop.** The board isn't fail-safe |
| `ls /dev/cu.usbmodem*` | A new port: the S3's native USB, `303a:1001` | Check D± and U3. TP1's UART pads are the fallback |
| `python -m esptool --chip esp32s3 -p /dev/cu.usbmodemXXXX flash_id` | ESP32-S3, 8 MB flash | Hold SW1 (BOOT) while plugging in, then retry |

## 4. Provision and flash

The board is flashed over its **native USB** (the `usbmodem` port). It has no UART bridge. The
firmware logs to that port too, as well as to UART0 on TP1.

Bring it up in **sandbox**, so it doesn't fight the prototype for the prod Thing. Two devices with
the same Thing name throw each other off IoT Core.

```bash
AWS_PROFILE=nakom.is-sandbox NPM_ENVIRONMENT=sandbox embedded/esp32/heatlink/scripts/provision-device.sh --board pcb-v1
. ~/esp/v5.5/esp-idf/export.sh && (cd embedded/esp32/heatlink/esp32s3 && idf.py build)
NPM_ENVIRONMENT=sandbox embedded/esp32/heatlink/esp32s3/scripts/flash-manual.sh /dev/cu.usbmodemXXXX
(cd embedded/esp32/heatlink/esp32s3 && idf.py -p /dev/cu.usbmodemXXXX monitor)
```

`flash-manual.sh` signs the image with the sandbox key first (STAT-81). In the log, look for
`board pcb-v1` and the MQTT subscription, then the status LED goes green. If the log says the board is
unknown, the `prov` partition doesn't match this image: re-run `provision-device.sh --board pcb-v1`
and flash again.

The current with Wi-Fi up should average about 100 mA, with peaks to about 350 mA. It rises by about
40 mA with the relay on.

## 5. Bench check

Stop the sandbox daemon if one is running, then:

```bash
embedded/esp32/heatlink/venv/bin/python embedded/esp32/heatlink/bench/hl-bench check --board pcb-v1
```

It asks for the switch (SW2) in each position, sends demands, and checks every `/status`. At each step
it asks about J2 (meter on continuity: closed when the relay is on, open when it's off) and about
D1's colour. It writes `bench-nakostat-heatlink-pcb-v1-<time>.md`; keep it with the board.

## 6. Signed OTA

From Fleet (sandbox), update to the latest published version. `ota_progress` should arrive, then a
restart, then `ota_complete`, with `hl-bench watch` showing the new version. Then offer an image
that should be refused, with the bench watcher running:

- an unsigned build;
- one signed with the prod key.

Each should end in `ota_error`, with the heatlink still on the old version.

## 7. Move to prod

When the board replaces the prototype on the boiler:
- reprovision it for prod (`AWS_PROFILE=nakom.is-admin NPM_ENVIRONMENT=prod … --board pcb-v1`);
- flash it with `NPM_ENVIRONMENT=prod`, so it's signed with the prod key;
- unplug the prototype first.

Then follow the live trial in [`heatlink-prototype-wiring.md`](heatlink-prototype-wiring.md), with
`hl-bench trial --env prod` running.
