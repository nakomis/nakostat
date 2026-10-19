# Nakostat — Bill of Materials

A DIY smart thermostat replacing a failed Nest + Heatlink. This BOM covers the
two physical units — the **thermostat** (Raspberry Pi touch UI + sensor) and the
**heatlink** (ESP32 boiler relay controller) — plus the bits to box each one up
tidily. The two units sit in **different rooms** and talk only over WiFi/MQTT, so
they go in **two separate enclosures**, not one.

> **Boiler:** Ideal Logic+ Combi (24/30/35). Per its manual (Frames 30–32) the
> call-for-heat interface is the **`ROOM STAT/TIMER`** terminal pair, which is
> **230 V mains-switched, *not* volt-free** — "all external controls and wiring
> must be suitable for mains voltage". A factory link wire bridges the pair
> (= permanent call for heat); a room stat replaces that link. **The heatlink
> relay therefore switches 230 V**, so a mains-rated relay and the §4 safety
> items are *required*, not optional. (OpenTherm is offered on Ideal's RF kit as
> a low-voltage modulating alternative — see §2 notes.)

> **Legend**
> - ✅ **Confirmed** — referenced directly in the codebase/firmware/config.
> - 🔧 **Design-implied** — required by the architecture (README/CLAUDE.md) but no
>   specific part is pinned in the repo yet; suggested part given, swap freely.
> - 💷 Prices are **rough indicative GBP** for budgeting only (ex. postage), not quotes.

---

## 1. Thermostat unit (Raspberry Pi)

The user-facing touch dial: Rust/egui UI on a Pi 5 driving a 7" touch panel, with
an I²C environmental sensor for temperature/humidity/air quality.

| # | Component | Spec / notes | Source | Qty | ~£ ea |
|---|-----------|--------------|--------|-----|-------|
| 1.1 | Raspberry Pi 5 | 4 GB or 8 GB; runs `nakostat` sensor daemon + egui UI | ✅ README / CLAUDE.md | 1 | 60–80 |
| 1.2 | RC070S 7" touch display | Elecrow 1024×600 capacitive touch | ✅ README / CLAUDE.md | 1 | 45–60 |
| 1.3 | ENS160 + AHT21 sensor module | I²C; CO₂/eCO₂/TVOC + temp/humidity. Drivers: `ens160` + `aht20-driver` | ✅ Cargo.toml `real-sensor` | 1 | 8–12 |
| 1.4 | Pi 5 active cooler / heatsink | Pi 5 throttles without it; needed in a closed box | 🔧 | 1 | 5–8 |
| 1.5 | microSD card | 32 GB A2; Raspberry Pi OS + `/opt/nakostat` | 🔧 | 1 | 6–10 |
| 1.6 | Pi 5 PSU (27 W USB-C PD) | Official 5 V/5 A; or shared rail (see §3) | 🔧 | 1 | 12 |
| 1.7 | Qwiic/JST-SH or DuPont leads | Sensor → Pi I²C (SDA/SCL/3V3/GND) | 🔧 | 1 set | 2–4 |
| 1.8 | FFC/DSI + USB or HDMI cabling | Per RC070S wiring (display + touch) | 🔧 | 1 set | — (often in kit) |

**Notes**
- The sensor daemon builds to a binary named `nakostat`, deployed to
  `/opt/nakostat/nakostat` and run as a systemd service (see `embedded/pi/CLAUDE.md`).
- Sensor is I²C — only 4 wires (3V3, GND, SDA, SCL). Confirm the module's I²C
  address(es) don't clash if anything else shares the bus.

---

## 2. Heatlink unit (ESP32 boiler controller)

Replaces the Nest Heatlink: receives the call-for-heat decision over MQTT and
switches the boiler. Firmware target is **ESP32-S3-WROOM N16R8** (16 MB flash,
8 MB PSRAM), with onboard SD logging and BLE/S3 OTA.

| # | Component | Spec / notes | Source | Qty | ~£ ea |
|---|-----------|--------------|--------|-----|-------|
| 2.1 | ESP32-S3-DevKitC-1 (N16R8) | 16 MB flash / 8 MB PSRAM; QIO+OPI; board id `esp32-s3-devkitc-1` | ✅ platformio.ini | 1 | 10–18 |
| 2.2 | microSD card | Small (≥4 GB) for `SDLogger` on-device logs | ✅ firmware `SDLogger` | 1 | 4–6 |
| 2.3 | **Mains-rated** relay module / SSR | Switches the boiler's **230 V** `ROOM STAT/TIMER` line. Contacts rated ≥250 V AC; 3.3 V-logic, opto-isolated. SSR must be an AC-mains SSR. ❌ *not* a dry-contact-only board | 🔧 (mains per boiler manual) | 1 | 3–8 |
| 2.4 | 3-way rotary switch | Physical override **auto / off / on** | 🔧 README "3-way rotary switch" | 1 | 3–6 |
| 2.5 | Pull resistors / wiring for switch | Read 3-way position on 2 GPIOs (or 1 ADC) | 🔧 | 1 set | 1 |
| 2.6 | ESP32 PSU (5 V) | 5 V/2 A USB or bare 5 V; or shared rail (§3) | 🔧 | 1 | 6 |
| 2.7 | Screw terminal blocks | Boiler heat-demand pair + mains-in if used | 🔧 | 2–3 | 1 |

**Notes**
- **Boiler interface (confirmed from manual):** the Ideal Logic+ Combi uses a
  **230 V mains-switched** `ROOM STAT/TIMER` pair — *not* volt-free. Remove the
  factory **link wire** between the two terminals and wire the relay's **COM + NO**
  in its place; closed = call for heat. The boiler supplies the live (protected by
  its own 3 A fuse), so you don't feed the relay contacts from a separate spur —
  but everything on that side is mains and must be treated as §4.
- This is exactly the job the old Nest Heatlink did (mains switching near the
  boiler, driven by a low-voltage thermostat) — validating the two-box split:
  ESP32 heatlink at the boiler, Pi UI elsewhere.
- **OpenTherm alternative (future):** Ideal's RF Electronic Programmable kit
  supports OpenTherm — a low-voltage *modulating* digital protocol. Electrically
  safer and allows modulating control, but needs an OpenTherm interface board, not
  a simple relay, so it doesn't match the current relay-switch firmware. Noted as a
  possible future upgrade.
- Current `src/main.cpp` is the bootstrap (WiFi + BLE OTA + SD); the relay-drive
  and rotary-switch GPIO logic are the next firmware step (schedule logic landed
  under STAT-45). Pick GPIOs that are safe at boot (avoid strapping pins) once wiring.
- OTA is the custom BLE/S3 flow inherited from bootboots — no Arduino OTA.

---

## 3. Enclosures & integration parts

Two enclosures — one per room — and the bits to tidy each.

> **Two boxes, not one.** The Pi (thermostat) and the ESP32 (heatlink) live in
> **different rooms** and communicate only over WiFi/MQTT via AWS IoT — there is no
> wire between them. So this is two separate enclosures: a low-voltage thermostat
> box and a mains heatlink box. Each has its own PSU (no shared rail). Confirm
> **WiFi coverage in both rooms** — especially the boiler location, which is often
> a loft/cupboard with weak signal.

### 3A. Thermostat box (Pi's room) — low voltage only, no mains

| # | Component | Spec / notes | Source | Qty | ~£ ea |
|---|-----------|--------------|--------|-----|-------|
| 3A.1 | Enclosure | Front/lid carries the 7" panel; Pi 5 + sensor behind. Wall-mount or desk stand | 🔧 | 1 | 10–25 |
| 3A.2 | Display bezel / front cut-out | Mount RC070S flush in the lid; vent for the sensor to read room air | 🔧 (3D-printable — see `3d/`) | 1 | print |
| 3A.3 | Internal wiring & DuPont/JST kit | Pi power + sensor I²C leads | 🔧 | 1 set | 3 |
| 3A.4 | Standoffs / M2.5 hardware | Mount Pi + sensor to the base | 🔧 | 1 set | 2 |

*(PSU = §1.6, 27 W USB-C. This box has no mains switching — §4 does not apply here.)*

### 3B. Heatlink box (boiler room) — contains 230 V, see §4

| # | Component | Spec / notes | Source | Qty | ~£ ea |
|---|-----------|--------------|--------|-----|-------|
| 3B.1 | Enclosure | Houses ESP32 + mains relay + 3-way override switch. Mount near the boiler; DIN-rail or wall box | 🔧 | 1 | 8–18 |
| 3B.2 | Cable glands / strain relief | Mains/boiler cable entry | 🔧 | 2–3 | 1 |
| 3B.3 | Screw terminals / WAGO / ferrules | Tidy, reliable mains terminations | 🔧 | 1 set | 4 |
| 3B.4 | Internal wiring & DuPont kit | ESP32 ↔ relay trigger, ESP32 ↔ rotary switch | 🔧 | 1 set | 3 |
| 3B.5 | Standoffs / M3 hardware | Mount ESP32, relay, PSU; keep mains side partitioned | 🔧 | 1 set | 3 |

*(PSU = §2.6, 5 V. Override switch = §2.4, mounted on this box's lid for hand access.)*

---

## 4. Safety / mains items ⚠️ — REQUIRED (heatlink box only)

The Ideal Logic+ Combi switches the call-for-heat at **230 V** (see §2), so the
heatlink box (§3B) **is** a mains device. These items are required, not optional.
The thermostat box (§3A) is low-voltage USB-C only and needs none of this.

| # | Component | Spec / notes | Qty |
|---|-----------|--------------|-----|
| 4.1 | Mains-rated relay/SSR | The §2.3 relay — contacts ≥250 V AC | 1 |
| 4.2 | Insulated barriers / partitioning | Keep the 230 V relay side clear of the 3.3 V/5 V logic; cheap relay boards have marginal creepage/clearance | 1 set |
| 4.3 | Earthing | Earth any metal enclosure / exposed metalwork | — |
| 4.4 | Double-pole isolation switch | Manual's Frame 30: 3 mm contact separation, accessible after install (may already exist on the boiler spur) | 1 |
| 4.5 | Fused spur | Boiler already fused at 3 A; only needed if you add a separate mains feed for the PSU | 0–1 |

> **⚠️ Mains heating wiring is notifiable/regulated work in many jurisdictions.**
> The heatlink switches 230 V on the boiler's `ROOM STAT/TIMER` terminals — if in
> any doubt, have a qualified heating/electrical engineer verify it. Likely the old
> Nest Heatlink was wired to these same terminals — that's your drop-in point.

---

## 5. Already covered (no hardware to buy)

These are part of the system but software/cloud-side, listed for completeness:

- **AWS IoT Core** — MQTT broker (Pi and ESP32 both connect with X.509 certs).
- **Lambda / DynamoDB / API Gateway (Cognito-gated)** — state, readings, setpoint,
  boiler-usage history (`infra/`).
- **Alexa thermostat skill** — voice control via an existing Amazon Echo (assumed
  already owned; not a build item).
- **Web dashboard** — `nakostat.nakomis.com` (React SPA, `web/`).

---

## 6. Rough budget summary

| Section | Indicative total (£) |
|---------|----------------------|
| 1. Thermostat (Pi) | ~140–185 |
| 2. Heatlink (ESP32) | ~30–50 |
| 3. Enclosures ×2 (Pi room + boiler room) | ~40–70 |
| 4. Mains safety (required) | ~15–30 |
| **Approx. total** | **~£235–345** |

*(Excludes the Echo, AWS running costs, and anything already on hand. Pi 5 + the
7" display dominate the cost.)*

---

### Open items to pin down before ordering

1. ~~Boiler interface~~ — **resolved: 230 V mains-switched** `ROOM STAT/TIMER` pair
   (Ideal Logic+ Combi manual). §2.3 = mains-rated relay; §4 applies in full.
2. **Relay vs. SSR** — both must be mains-rated. SSR is silent and long-lived but
   leaks a little (a tiny holding current could matter on a sensitive call-for-heat
   input); a mechanical relay is dead-simple and fully isolated. Mechanical is the
   safe default here.
3. ~~One PSU or two~~ — **resolved: two PSUs** (separate boxes/rooms). §1.6 for the
   Pi, §2.6 for the heatlink.
4. **WiFi at the boiler** — confirm signal reaches the heatlink box (loft/cupboard
   locations often don't); plan a repeater/AP if marginal.
5. **Display mounting** — design the front bezel/cut-out into the `3d/` enclosure.
6. **GPIO map** — assign ESP32 pins for relay drive + 3-way switch (avoid strapping
   pins) when the firmware logic is written.
