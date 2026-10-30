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
| Passives | 0402/0603 | — | As tinycrypt, plus the gate resistors (100 Ω, 100k) and the switch pull-ups |

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

- **Size and stack:** 66 × 30 mm, 2 layers, 1.6 mm FR-4, ENIG finish, black mask, white silk.
  Every part is on the top.
- **Layout:**
  - At x = 0, the gland end: J2 with its openings facing the gland, then the relay with its contacts
    towards J2.
  - In the middle: the relay driver, the BOOT button, the toggle with the LED beside it, then the
    USB socket on the long edge with its fuse, TVS, regulator and ESD.
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
  10.5 mm above that. Relay 15.3 mm, terminal block 14.1 mm, module 2.4 mm. The case lid needs a
  pocket around the toggle, so the M6 bushing comes through it with room for the nut.

## Pins (for the firmware)

`out/heatlink/pins.h` holds these; `board/heatlink_board.py` (`GPIO`) is the source, and
`embedded/esp32/heatlink/esp32s3/sdkconfig.board-v1` sets them in the firmware.

| Signal | GPIO |
|---|---|
| Relay (active-high) | 12 |
| Toggle "on" / "off" (active-low) | 13 / 14 |
| WS2812B DIN | 15 |
| BOOT button | 0 |
| USB D− / D+ | 19 / 20 |
| UART0 TX / RX (debug pads) | 43 / 44 |

## Not on this board

- **No mains power supply.** Power comes over USB.
- **No current sensing and no second relay.**
- **No secure element.** Signed OTA uses the S3's own secure boot (Phase 2 firmware).
