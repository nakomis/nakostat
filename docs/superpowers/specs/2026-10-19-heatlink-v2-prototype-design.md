# Heatlink v2 prototype: end-to-end heating control

Date: 19 Oct 2026 · Plane: STAT-69 (epic) · Status: approved decisions, building

## Why

The Nest thermostat and Heatlink are dead. Nakostat has most of a replacement built, but the
heating cannot actually turn on yet: nothing publishes the boiler command, the Pi's IoT policy
couldn't if it tried, setpoints from the web go to a topic nobody reads, and there is no Alexa code.
This phase closes every gap on a **breadboard prototype**, then proves it with a **live trial on the
boiler**. The PCB (gerbers) waits until Martin OKs the prototype (Phase 2).

## Decisions (Martin, 19 Oct 2026)

| Question | Decision |
|---|---|
| What does "prototype OK" mean? | A live trial on the boiler: mains-rated relay module in a printed case on `ROOM STAT/TIMER`. Martin (or an electrician) does the wiring. |
| Boiler behaviour when the Pi / internet link is lost | The heatlink falls back to a locally held copy of the schedule. |
| Parts | Martin has an ESP32-S3-DevKitC-1 N16R8, a mains-rated relay module, a 3-way switch, breadboard, jumpers and LEDs. Ask about anything else. |
| Case scope | Heatlink only. Two parts that screw together. |

Technical decisions (Claude's, stated so they can be overridden):

- **Firmware is rewritten in ESP-IDF 5.5** on the kappa-warmer/tinycrypt pattern: portable C in
  `port/` built natively and tested with pytest, IDF glue in `esp32s3/main/`, credentials in a `prov`
  NVS partition, the Fleet MQTT protocol, OTA with rollback. The Arduino `boiler/` firmware is deleted.
- **OTA is unsigned for the prototype** (Fleet capability `ota`, as kappa-warmer). Signed OTA
  (`ota-signed`) comes with the PCB in Phase 2.
- **No PSRAM, 4 MB partition table**, so the same image runs on the DevKitC (16 MB) and on the
  Phase 2 module (ESP32-S3-MINI-1-N8). CPU at 160 MHz.
- **Case in OpenSCAD**: local, deterministic, renderable from CI, no Onshape API quota.
- **The Pi daemon stays the brain** (memory: `project_nakostat_control_architecture`). The heatlink is a
  switch with a watchdog and a fallback schedule.

## Non-goals (this phase)

- The PCB, its power supply design, and the final enclosure (Phase 2).
- A Pish case. Home Assistant. A second sensor node. A local MQTT broker (STAT-43).
- Multiple named schedules (STAT-50); one schedule only.
- OpenTherm / modulating control.

## System

```
 Pish (dial) ──pish/setpoint──┐
 Web ──API──► api/setpoint, api/mode, api/schedule ─┤
 Alexa ──Lambda──► (same API topics) ───────────────┤
                                                     ▼
                         Pi daemon (brain): schedule + override + hysteresis
                            │  demand every 30 s            ▲ status
                            ▼                                │
                 nakostat/nakostat-heatlink/commands   …/status
                            │                                │
                         Heatlink (ESP32-S3) ── relay ── boiler ROOM STAT/TIMER
                            ▲
                       3-way switch (on / auto / off)
```

### Topic and payload contracts (all components MUST match these)

`{env}` is `sandbox` or `prod`. The heatlink uses Fleet's shape (`{project}/{thing}/…`). The sandbox
and prod accounts are separate, so the thing name has no env suffix. Existing Pi topics keep their shape.

| Topic | Publisher → consumer | Payload |
|---|---|---|
| `nakostat/{env}/pi/readings` | daemon → rule → readings table | unchanged |
| `nakostat/{env}/pish/setpoint` | Pish → daemon | `{"temperature":21.0,"timestamp":"…Z","userId":"…"}` (unchanged) |
| `nakostat/{env}/api/setpoint` | setpoint Lambda, Alexa Lambda → daemon | same shape as `pish/setpoint` |
| `nakostat/{env}/api/mode` | mode Lambda, Alexa Lambda → daemon | `{"mode":"heat"\|"off","timestamp":"…","userId":"…"}` |
| `nakostat/{env}/api/schedule` | schedule Lambda → daemon | `{"schedule":<Schedule JSON>,"timestamp":"…","userId":"…"}` |
| `nakostat/{env}/pi/state` | daemon → rule → state table `deviceId="pi"` | see *Daemon state* |
| `nakostat/{env}/pi/schedule` | daemon → rule → state table `deviceId="schedule"` | `{"schedule":<Schedule JSON>,"timestamp":"…"}`, on change and hourly |
| `nakostat/nakostat-heatlink/commands` | daemon, Fleet → heatlink | see *Heatlink commands* |
| `nakostat/nakostat-heatlink/responses` | heatlink → Fleet, daemon | Fleet replies (`version`, `ota_*`, `pong`) |
| `nakostat/nakostat-heatlink/status` | heatlink → Fleet, daemon, rule → state table `deviceId="heatlink"`, boiler-usage Lambda | see *Heatlink status* |

`<Schedule JSON>` is the daemon's existing day-keyed persisted format (STAT-46, `schedule.rs`).

#### Heatlink commands (field `command`, as Fleet's `POST /devices/{id}/command`)

- `{"command":"demand","on":true,"source":"schedule"|"override"|"frost"|"off","setpoint":20.5,"temperature":19.8,"ttl_s":300}`
  The daemon sends this every 30 s and immediately on change. The heatlink follows `on` while the
  last demand is younger than `ttl_s` (clamped 60–1800, default 300).
- `{"command":"set_schedule","tz":"GMT0BST,M3.5.0/1,M10.5.0","comfort_c":18.0,"duty_pct":67,"days":[[[360,20.0],[540,16.0],…], …7 days, Mon first]}`
  Each entry is `[minute_of_day, target_c]`. At most 8 entries a day. Stored in NVS. The daemon sends
  it on connect, on schedule change, and every 6 h.
- `{"command":"get_status"}` → an immediate status with `reason:"request"`.
- Fleet's own: `get_version`, `ping`, `ota_update`, `url_chunk`, `ota_cancel`, with message shapes
  exactly as kappa-warmer's `port/ota_cmd.c` (shared with esp32-bootstrap's MqttOTA; do not change them).
- Unknown commands get `{"type":"error","message":"unknown command"}` on `/responses`.

#### Heatlink status (published on `/status`)

The fields Fleet reads (copy kappa-warmer's `status_json`), plus:
`{"mode":"auto"|"fallback"|"force_on"|"force_off","relay":true,"switch":"auto"|"on"|"off","source":"schedule"|"override"|"frost"|"off"|"fallback"|"switch","demand_age_s":12,"schedule_known":true,"time_valid":true,"rssi":-61,"uptime_s":3600,"reason":"boot"|"heartbeat"|"change"|"request"}`
It publishes every 60 s (`heartbeat`) and immediately whenever `mode` or `relay` changes (`change`).

#### Daemon state (`pi/state`, every 60 s and on change)

`{"timestamp":"…","temperature":19.8,"humidity":45.2,"mode":"heat"|"off","setpoint":20.5,"scheduled_setpoint":20.0,"override":{"setpoint":20.5,"until":"…Z"}|null,"demand":true,"demand_source":"schedule","heatlink":{"mode":"auto","relay":true,"switch":"auto","seen":"…Z"}|null}`

The daemon also adds this object, as `{"type":"state",…}`, to its Unix socket. Existing reading lines
stay as they are, so Pish can show the real setpoint and whether the boiler is firing.

## Control logic (daemon)

- **Effective setpoint**: in mode `off` it is the frost floor (7 °C). Otherwise it is the active override,
  if any, else the schedule. A manual setpoint (Pish, web, Alexa) is an **override that lasts until the
  next schedule transition**, Nest-style (STAT-47).
- **Hysteresis**: demand turns on when `T < SP − 0.3`, and off when `T ≥ SP + 0.2`.
- **Short-cycle guard**: once the relay changes, demand doesn't change again for 3 minutes, unless
  the setpoint changes by 1 °C or more.
- **Stale sensor** (no good reading for 5 min): the daemon **stops sending demand**, so the heatlink
  falls back. Losing the sensor and losing the link are deliberately the same failure.
- Every relay change gets a `demand_source`, which the heatlink echoes back as `source`.

## Heatlink logic (firmware, `port/heatlink.c`, pure and host-tested)

Inputs: switch position, last demand (and its age), stored schedule, wall clock validity, time.

| Switch | Condition | Mode | Relay |
|---|---|---|---|
| on | — | `force_on` | on |
| off | — | `force_off` | off |
| auto | demand age < ttl | `auto` | demand.on |
| auto | demand stale, schedule known, time valid | `fallback` | see below |
| auto | demand stale, no schedule or no valid time | `fallback` | off |

**Fallback** heats when the schedule target at local time is at least `comfort_c`. While heating, it runs
a duty cycle of `duty_pct`% of each 60-minute window (default 67%: 40 min on, 20 min off). There is no
room temperature at the boiler, so this behaves like an old timer-only programmer, with the radiator
TRVs and the boiler's own frost protection as backstops. *Martin can tune `comfort_c` and `duty_pct`
later from the daemon config.*

- **Cold boot**: the relay stays off until the first demand arrives, or until fallback kicks in after `ttl`.
- **The switch is read by firmware** in this prototype: debounced for 50 ms and polled every 20 ms.
  The PCB may add a hardware path in Phase 2.

## Prototype hardware

Board: **ESP32-S3-DevKitC-1 N16R8**. Avoid GPIO 35–37 (octal PSRAM), the strapping pins 0, 3, 45 and 46,
19 and 20 (USB), and 43 and 44 (UART0).

| Signal | GPIO | Notes |
|---|---|---|
| Relay IN | 4 | Kconfig `HEATLINK_RELAY_ACTIVE_LOW` (default **y**). Active-low is driven **open-drain**: low = on, released = off (the module's pull-up). That works whether the module runs at 3.3 V or 5 V, and the relay is off while the GPIO floats at boot. An active-high module uses push-pull. |
| Switch "on" throw | 5 | Internal pull-up; switch common to GND |
| Switch "off" throw | 6 | Internal pull-up; centre position (neither throw) = **auto** |
| RGB status LED | 48 | The DevKitC's onboard WS2812. Kconfig, because rev 1.1 boards use 38 |

Status LED colours:
- green: auto, idle
- orange: relay on
- blue: fallback
- purple: forced on or off
- red, blinking: no Wi-Fi or no IoT connection

Power comes from a 5 V USB charger into the DevKitC's USB port. The relay module's VCC is the DevKitC's 5 V pin.

### Mains and safety (live trial)

- The breadboard **never carries mains**. On the bench the relay switches an LED or a dummy load.
- For the trial, only the relay module's COM/NO screw terminals carry 230 V. The module sits in its
  own compartment of the printed case, behind a full-height barrier, with the boiler cable entering
  through a strain-relieved gland. COM + NO replace the factory link between `ROOM STAT/TIMER`, as
  in `bom.md`.
- Isolate at the boiler's double-pole spur before touching anything. **Have a qualified person check
  it before the trial.** Print the case in PETG or ASA, not PLA, which softens near a boiler.

## Prototype case (`3d/heatlink-prototype/`, OpenSCAD)

- Two parts: a **base**, which holds the half-size breadboard in a pocket, the relay module on M3 bosses,
  the barrier wall, the cable gland hole and the USB cable notch; and a **lid**, which carries the switch
  hole and the LED window.
- They join with **M3 × 10 screws into M3 heat-set inserts**. A `pilot` option swaps in self-tapping holes.
- Parametric: breadboard, relay module footprint and hole pattern, switch hole diameter, gland size.
  The defaults are common parts. **Martin to confirm the relay module and switch dimensions** (non-blocking).
- `make.sh` renders both STLs with the OpenSCAD CLI. The STLs are committed.

## Infra changes

- **IotStack**:
  - New Thing `nakostat-heatlink` with attributes `project=nakostat`, `deviceType=heatlink`,
    `capabilities=ota`, and a Fleet-shaped policy (copy kappa-warmer `device-stack.ts`). Its certificate
    is made by `provision-device.sh`, never by CloudFormation.
  - Pi policy:
    - may publish `pi/*` and `nakostat/nakostat-heatlink/commands`;
    - may subscribe to and receive `api/*`, `pish/setpoint` and `nakostat/nakostat-heatlink/{status,responses}`.
  - The old `nakostat-esp32-*` Thing, policy and certificate are removed.
- **IotRulesStack**:
  - heatlink status → state table `deviceId="heatlink"`;
  - `pi/state` → `deviceId="pi"`;
  - `pi/schedule` → `deviceId="schedule"`;
  - heatlink status with `reason="change"` → boiler-usage Lambda, which writes `{state, source}`;
  - the esp32 rule is removed.
- **ApiStack**:
  - `GET /state` returns `{pi, heatlink, schedule}`;
  - `POST /setpoint` publishes only (the daemon is the authority);
  - new `POST /mode` and `PUT /schedule`;
  - `GET /readings` and `GET /boiler-usage` are unchanged.
- **AlexaStack (eu-west-1, new)**:
  - a Smart Home skill Lambda covering `Alexa.Discovery`, `Alexa.Authorization` (AcceptGrant),
    `Alexa.ThermostatController` (SetTargetTemperature, AdjustTargetTemperature, SetThermostatMode
    HEAT/OFF), `Alexa.TemperatureSensor`, `Alexa.EndpointHealth` and ReportState;
  - state is read from the eu-west-2 state table, and it publishes to the `api/*` topics;
  - account linking uses a new Cognito app client on the shared pool;
  - the skill ID and vendor ID come from SSM, set once the skill exists.
  - `skill-package/` holds the skill manifest for the ASK CLI. **Creating the skill is Martin's step.**
- **GithubCiStack**: allow putting and getting `s3://nakomis-firmware-{env}/nakostat/*`.

## Web

- Fix the contract for the new `/state` shape. Components:
  - current temperature and humidity;
  - setpoint control (± in 0.5 °C steps, debounced);
  - Heat/Off mode;
  - heatlink panel (mode, switch position, relay, last seen, fallback warning);
  - 24 h temperature and humidity chart;
  - boiler on/off timeline;
  - schedule editor (week grid of transitions, saved with `PUT /schedule`).
- Vitest + RTL tests.

## Pish (separate repo, separate PR)

The nakostat widget reads the new `{"type":"state"}` socket lines. The dial shows the effective
setpoint (so an Alexa change shows up), plus a "heating" indicator. Its setpoint publish is unchanged.

## CI

- Replace the Arduino ESP32 job with a firmware job:
  - host build and pytest for `port/`;
  - `idf.py build` in the `espressif/idf:v5.5` container;
  - publish to the sandbox firmware bucket on a PR and to prod on merge (kappa-warmer's `ci-publish.sh`).
- Add an OpenSCAD render check for the case.

## Phase 2 (after Martin's OK, outline only)

A custom PCB generated in code on the tinycrypt pipeline (Python → `.kicad_pcb` → Freerouting → DRC →
JLCPCB gerbers, BOM and CPL). It uses an ESP32-S3-MINI-1-N8, an on-board mains-rated relay with proper
creepage/slot isolation, the switch, an LED, and the house USB connector or an on-board AC-DC module
(**a decision for Martin then**). Then the final two-part case around that board, and signed OTA.

## What only Martin can do

1. Flash the first image over USB, then run `provision-device.sh`, which needs AWS credentials.
2. Wire the bench prototype, then the live trial (or arrange an electrician), and print the case.
3. Approve prod deploys.
4. Create the Alexa skill in the developer console (or run `ask configure` once), then link the account in the Alexa app.
5. Confirm the relay module and switch dimensions and the module's trigger level.
