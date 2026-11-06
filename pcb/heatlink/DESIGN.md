# Nakostat heatlink board: design (STAT-75)

The heatlink on one board, for PCBWay to make and assemble. It replaces the prototype's ESP32-S3
DevKitC, relay module and loose toggle switch. It is powered from the house USB cable, and its relay
closes the boiler's 230 V `ROOM STAT/TIMER` pair to call for heat.

Decided with Martin (30 Oct 2026):

- House USB connector for power, so there is no mains power supply on the board.
- The ESP32-S3-MINI-1 is soldered directly to the board, as on tinycrypt.
- The relay and the switch are parts PCBWay can assemble.
- The status LED is a WS2812B-2020, as on tinycrypt.
- A PG7 gland brings the boiler cable in, at the end of the board with the mains terminals.
- An 8-way IO terminal block along one long edge and a 16-way boxed IDC header beside it (1 Nov
  2026): power and seventeen spare GPIOs, so that the boards not used as heatlinks are reusable as
  general Wi-Fi relay and IO boards.

## Blocks

| Block | Part | LCSC | Notes |
|---|---|---|---|
| MCU + radio | ESP32-S3-MINI-1-N8 | C2913206 | 15.4 × 20.5 mm, PCB antenna, 8 MB flash, pre-certified |
| Cable socket | JST SM05B-SRSS-G-TB | C265419 | House USB (tinycrypt J1): 1 VBUS, 2 D−, 3 D+, 4 CC, 5 GND |
| VBUS fuse | Littelfuse 1206L050YR | C163512 | 500 mA hold, 1 A trip, resettable |
| VBUS clamp | Littelfuse SMF5.0A | C151296 | 5 V TVS after the fuse: a reversed supply forward-biases it and trips the fuse |
| USB ESD | USBLC6-2SC6 | C7519 | On D+/D− and VBUS |
| 3.3 V regulator | AP2112K-3.3TRG1 | C51118 | 600 mA; Wi-Fi peaks are about 350 mA |
| Relay | Hongfa HF46F/5-HS1 | C5274168 | 5 V coil (125 Ω, 40 mA), SPST-NO, 5 A 250 V AC. **4 kV coil–contact, VDE 0631 reinforced insulation**; 11.5 mm between coil and contact pins |
| Relay driver | AO3400A | C20917 | Low-side N-FET, fully on at a 3.3 V gate |
| Flyback | 1N4148W | C81598 | Across the coil |
| Boiler terminals | Kefa KF128-5.08-2P | C474952 | 5.08 mm screw terminal, 250 V, wire entry facing the gland |
| Override switch | Yuen Fung MT-0-103 (MTS-103) | C1788493 | ON-OFF-ON toggle, M6 bushing through the lid, PC pins |
| Button | TS-1187A-B-A-B | C318884 | BOOT (GPIO0), for recovery only |
| Status LED | WS2812B-2020-V6 | C52917434 | Beside the toggle, under a light pipe |
| IO terminal | DORABO DB125-3.5-8P-GN-S | C5184954 | 8-way 3.5 mm screw terminal, 300 V 10 A, 8.6 mm tall |
| IDC header | ZHOURI DC3-2.54-16PAS | C2977594 | 16-way boxed header, 2.54 mm, keyed: a ribbon cable, or single female Dupont wires |
| Passives | 0402/0603 | — | As tinycrypt, plus the gate resistors (100 Ω, 100k), the switch pull-ups and the I²C pull-ups (4.7k) |

## Circuit

- **USB in:**
  - J1.1 → F1 (PTC) → VBUS.
  - D2 (TVS) runs from VBUS to GND.
  - D−/D+ pass through U3 to GPIO 19/20.
  - CC → 5.1 kΩ → GND, so a USB-C charger turns on 5 V.
- **3.3 V:** U2 with 10 µF in, and 10 µF + 100 nF out. The module has 10 µF + 100 nF at its 3V3 pin. The EN pin has an RC network (10k and 1 µF).
- **Relay:**
  - The coil runs from VBUS to the FET's drain. The gate takes GPIO 12 through 100 Ω and has a 100k pull-down. At reset, and until the firmware drives the pin, the relay is off.
  - The 1N4148W clamps the coil's flyback.
  - The coil draws 40 mA from VBUS, so the 500 mA fuse is never close.
- **Contacts:** pads 3 and 4 run to J2's two terminals. When the relay closes, it joins the boiler's permanent live (L) to its switched live (SL): that is the call for heat. This replaces the factory link wire, as the prototype's relay did.
- **Toggle:** common to GND, with the throws on GPIO 13 ("on") and 14 ("off"). Each throw has a 10k pull-up. The centre position is auto. Which throw is "on" depends on the lever direction, so check it on the bench; the firmware can swap the two GPIOs.
- **LED:** GPIO 15 → 330 Ω → DIN, powered from 3V3.
- **Button:** GPIO 0 → GND, with a 10k pull-up.
- **Debug pads (TP1):** EN, RX, TX, G, 3V3, as on tinycrypt.
- **IO terminal (J3):** for reuse; the heatlink firmware doesn't use it.

  | Terminal | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
  |---|---|---|---|---|---|---|---|---|
  | Signal | 5V | GND | 3V3 | SDA (GPIO 1) | SCL (GPIO 2) | GPIO 4 | GPIO 5 | GPIO 6 |

  - 5V is VBUS after the polyfuse. It sits at the end, next to GND, so a stray strand from it can
    only reach GND, and the fuse limits that. 3V3 next to a GPIO does no harm.
  - SDA and SCL have 4.7k pull-ups to 3V3. All five GPIOs are ADC1 pins and go straight to the
    module, as on a dev board: no series resistors. The chip's own ESD diodes (about 2 kV) are
    the only protection, so don't run long cables from it to anything outside the case.
- **IDC header (J4):** also for reuse. Odd pins are the row on the key side; pin 1 is marked on
  both silkscreens, and the back labels every pin.

  | Pins | 1–2 | 3–4 | 5–6 | 7–8 | 9–10 | 11–12 | 13–14 | 15–16 |
  |---|---|---|---|---|---|---|---|---|
  | Signals | 3V3, GND | GPIO 7, 8 | GPIO 9, 10 | GPIO 11, GND | GPIO 16, 17 | GPIO 18, 21 | GPIO 38, 39 | GPIO 40, 5V |

  - The two grounds sit between the signal groups, so each signal in a ribbon has a return wire
    near it, and a daughterboard's supply current returns through two pins.
  - 7–11 are ADC1 and touch pins. The S3's GPIO matrix routes I²C, SPI, UART or PWM to any of
    them. Like J3's, they go straight to the module.
  - Buy a 16-way IDC ribbon cable (2.54 mm, female–female); at the far end, an IDC16 screw-terminal
    breakout, an IDC16 breadboard adapter, or a daughterboard with the same header.

## Mains safety

The relay contacts and J2 carry 230 V. Everything else is safety extra-low voltage (SELV), powered by
the USB charger. The board keeps the two apart:

- **A mains area** at the gland end of the board, x < 28.5 mm. It holds J2, the relay's contact
  pins, the two mains tracks and two unplated mounting holes. Both silkscreens mark it with a dashed
  outline and "230 V".
- **Spacing, checked by KiCad's DRC on every build** (`board/kicad_pcb.py` writes the rules to
  `nakostat-heatlink.kicad_dru`; the build fails on any violation):

  | Between | Minimum | Insulation type |
  |---|---|---|
  | Mains and anything else | 8 mm | Reinforced |
  | The two mains nets | 2.5 mm | Functional (IEC 60664-1, 250 V, pollution degree 2) |
  | Mains and the board edge or any hole | 3 mm | |

  The 8 mm rule covers the ground pour as well.
- **Creepage equals clearance here.** There are no slots, and every surface path is at least as long
  as the straight-line distance.
- **The relay bridges the boundary itself.** Its coil and contact pins are 11.5 mm apart, and it is
  rated for reinforced insulation (4 kV).
- **No ground pour in the mains area**, on either side.
- **Holes:** the two holes in the mains area are unplated with no copper, so a screw there connects
  to nothing. The two on the low-voltage side are plated and on GND.
- **Load:** the call-for-heat current is milliamps (it's a signal into the boiler's PCB), so the
  1.2 mm mains tracks are wide for robustness, not current. The boiler's own fused spur protects the
  circuit, as it did with the link wire.

## Board

- **Size and stack:** 66 × 49 mm, 2 layers, 1.6 mm FR-4, ENIG finish, black mask, white silk.
  Every part is on the top.
- **Layout:**
  - At x = 0, the gland end: J2 with its openings facing the gland, then the relay with its contacts
    towards J2.
  - In the middle: the relay driver, the BOOT button, the toggle with the LED beside it, then the
    USB socket on the long edge with its fuse, TVS, regulator and ESD.
  - Along the long edge opposite the USB socket, on the low-voltage side, a 19 mm strip: J3 at the
    edge, with its wire openings facing out (its end pin keeps the 8 mm from the relay's contacts),
    then J4 with its key slot facing into the board.
  - At the far end: the module, with its antenna **overhanging the x = 66 edge by 5.05 mm**
    (intentional, and marked on Dwgs.User). That keeps the antenna as far from the relay and the
    mains as the board allows.
- **Mounting:** four M3 holes, one per corner. The two in the mains area are unplated; the two by
  the module have plated GND rings.
- **Routing:**
  - The mains tracks are routed by hand, on F.Cu only.
  - Freerouting does everything else on the low-voltage side and never enters the mains area.
  - GND is carried by the pours. Every small GND pad has its own via to the B.Cu pour, placed before
    routing, and there are stitching vias on a 2 mm grid.
- **Chi on the back** (house rule): his head and shoulders, 24.0 × 19.7 mm, over the low-voltage
  side. Underneath: "Chi", the credit and the board name.
  - **Source:** Martin's photo of Chi on the cat tree (30 Oct 2026). macOS Vision lifts the outline
    (`art/liftsubject.swift`), and `art/make_chi.py` keeps the darker stripes, eye and nose as bare
    board, with an oval vignette at the sides.
  - **What's kept clear:** stitching vias avoid his white fur, no via sits under the text, and there
    are no pixels over through-hole pads or H3's ring.
- **Heights above the board** (for the case): toggle bushing top 18.1 mm, with the lever another
  10.5 mm above that. Relay 15.3 mm, terminal block 14.1 mm, IO terminal 8.6 mm, IDC header 9 mm, module 2.4 mm. The case lid needs a
  pocket around the toggle, so the M6 bushing comes through it with room for the nut, and a slot
  in the side wall over J3's openings, with room for a screwdriver above it, and a slot in the lid
  over J4 for the ribbon cable (or a removable panel, for the heatlink, which doesn't use it).
  The lid also needs a vent over U2, the 3.3 V regulator, at (33.5, 42.0) mm from the mains-end
  corner, the dashed ring in `docs/heatlink-board-key.md`. It dissipates about 0.2 W on average and 0.6 W in Wi-Fi
  bursts.

## Pins (for the firmware)

`out/heatlink/pins.h` holds these; `board/heatlink_board.py` (`GPIO`) is the source. The firmware's
board `pcb-v1` (`embedded/esp32/heatlink/port/board.c`) uses them, and its tests check the two agree.

| Signal | GPIO |
|---|---|
| Relay (active-high) | 12 |
| Toggle "on" / "off" (active-low) | 13 / 14 |
| WS2812B DIN | 15 |
| BOOT button | 0 |
| USB D− / D+ | 19 / 20 |
| UART0 TX / RX (debug pads) | 43 / 44 |
| IO terminal SDA / SCL (4.7k pull-ups) | 1 / 2 |
| IO terminal GPIOs | 4, 5, 6 |
| IDC header GPIOs | 7, 8, 9, 10, 11, 16, 17, 18, 21, 38, 39, 40 |

## Pre-order review (4 Nov 2026)

An independent review before ordering found no blockers and nothing that needs a board change:

- **Circuit:**
  - The shared blocks match tinycrypt's working board. The new parts here are F1, D2 and the relay
    driver.
  - The AO3400A is fully on at a 3.3 V gate. Worst-case coil voltage is about 4.1 V, against the
    HF46F's 3.75 V must-operate.
  - The relay stays off from reset, because GPIO 12 isn't a strapping pin and R8 holds the gate.
  - No strapping pins or flash pins are used. GPIO 39/40 on J4 are JTAG pads only if eFuses select
    them.
  - USB D−/D+ go to GPIO 19/20.
  - D2's cathode is on VBUS.
- **Margins** (documented in README, with no change):
  - The AP2112K at θJA about 184 °C/W runs about +40 K at the heatlink's average load.
  - F1's 500 mA hold derates as it warms. Both are fine for the heatlink, which is wall-mounted
    beside the boiler rather than in a cupboard, but they limit what J3/J4 can power.
  - U2 is the warmest part, so the case has a vent above it (see `docs/heatlink-board-key.md`).
- **Mains spacing measured on the board:**
  - Nearest low-voltage copper: 9.0 mm. The GND pour is exactly 8.00 mm from K1.3.
  - L to SL: 2.68 mm minimum.
  - Mains to the board edge: at least 5.25 mm. Mains to holes: at least 4.78 mm.
  - The relay's pad-edge gap between coil and contacts is 9.6 mm, and LCSC lists the HF46F as
    meeting VDE 0631 reinforced insulation.
  - 8 mm meets the reinforced creepage requirement at pollution degree 2 with margin, so a slot
    wouldn't help.
- **Footprints:**
  - The relay's 7.0 mm contact pitch and Ø1.1 holes are as specified.
  - The toggle's slots (1.2 × 2.5 mm) suit its 0.8 × 2.0 mm pins, checked against Yuen Fung's
    drawing.
  - The pins of the LED and J4 are right.
  - J2/J3's holes (Ø1.6/1.4) are generous, which suits hand-soldered through-hole parts.

## Not on this board

- **No mains power supply.** Power comes over USB.
- **No current sensing and no second relay.**
- **No secure element.** Signed OTA uses ESP-IDF's secure boot v2 signature scheme, checked by the app on update, without
  burning secure boot eFuses (STAT-81).
