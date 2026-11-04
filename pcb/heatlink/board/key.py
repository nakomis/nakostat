"""The board key: what every part is, what it does and why it's there, as a numbered diagram on
the top render (<stem>-key.png) and a markdown key (docs/heatlink-board-key.md at the repo root)
for the README and the blog posts.

    ./.venv/bin/python -m board.key        # from the existing top render, without a rebuild

build.py writes both after the renders. Positions come from the placement (heatlink_board.AT),
so the markers follow the parts; tests check that every part has an entry."""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from board import heatlink_board as hb

# group: (marker colour, heading, what the block is for)
GROUPS = {
    "mains": ("#e5484d", "230 V mains",
              "The only part of the board at 230 V. It sits at one end, inside the dashed outline, at "
              "least 8 mm from everything else (more than reinforced insulation needs), with no copper "
              "pour, so nothing low-voltage can reach it."),
    "power": ("#f5a524", "USB power and protection",
              "Brings 5 V in from the USB cable, protects the board against shorts, spikes, static and "
              "a reversed cable, then makes the 3.3 V the electronics run on."),
    "relay": ("#a855f7", "Relay driver",
              "Turns a weak 3.3 V GPIO signal into enough current for the relay coil, and makes sure the "
              "relay is off whenever the firmware isn't in control."),
    "mcu": ("#3b82f6", "ESP32 module and support",
            "The ESP32-S3 runs the firmware: Wi-Fi, MQTT to AWS, the fallback schedule and OTA updates. "
            "Its support parts give it clean power and a clean start."),
    "ui": ("#22c55e", "Switch, button and LED",
           "The local controls and indicator, so the heatlink can be used and diagnosed standing at the "
           "boiler with no phone or network."),
    "io": ("#14b8a6", "Reuse I/O",
           "Not used by the heatlink. They make the spare boards reusable as general Wi-Fi I/O boards."),
    "mech": ("#9ca3af", "Mounting and recovery", "Mounting holes and the serial recovery port."),
}

# ref: (group, part, what it does, why it's there). Order is the numbering on the diagram.
KEY = {
    "J2": ("mains", "Kefa KF128 2-way screw terminal", "The boiler's L and SL, in place of the link wire",
           "Screw terminals take the boiler's mains flex without soldering. The 5.08 mm pitch keeps L and SL "
           "over 2.5 mm apart, and the openings face the cable gland."),
    "K1": ("mains", "Hongfa HF46F/5-HS1 relay", "5 V coil; its contact joins L to SL to call for heat",
           "A relay puts a physical gap between the 5 V electronics and 230 V. This one is rated for "
           "reinforced insulation between coil and contacts, so it can bridge the mains boundary on its "
           "own. Its 5 A rating is far beyond the milliamp signal, so it won't wear."),
    "Q1": ("relay", "AO3400A N-MOSFET", "Switches the relay coil to GND",
           "A GPIO gives a few milliamps at 3.3 V; the coil needs 40 mA at 5 V. The MOSFET is the switch in "
           "between, and this one turns fully on with 3.3 V on its gate."),
    "D3": ("relay", "1N4148W diode", "Flyback clamp across the coil",
           "When the coil switches off, its collapsing magnetic field kicks back a voltage spike. The diode "
           "gives that energy a safe path so it can't damage Q1."),
    "R7": ("relay", "100 Ω", "Gate resistor, GPIO 12 to Q1",
           "Limits the current pulse into the MOSFET's gate as it switches, keeping the edges clean."),
    "R8": ("relay", "100 kΩ", "Gate pull-down",
           "While the ESP32 is booting or resetting, its pins float. This holds the gate low, so the relay "
           "and the boiler stay off until the firmware turns them on: fail-safe."),
    "J1": ("power", "JST SM05B-SRSS (house USB)", "5 V power and USB data in",
           "The house USB connector, the same on every one of Martin's boards: one cable for power and "
           "flashing, and no mains power supply on the board."),
    "F1": ("power", "1206L050 polyfuse", "500 mA resettable fuse on 5 V",
           "If anything shorts on the 5 V side (a stray wire on J3/J4, a failed part) it heats up and cuts "
           "the current, then resets once the fault is gone. There's no fuse to replace."),
    "D2": ("power", "SMF5.0A TVS diode", "Clamps spikes on 5 V",
           "Absorbs voltage spikes on the 5 V line. If a miswired cable ever feeds reversed voltage, it "
           "conducts hard and trips F1, protecting everything after it."),
    "U3": ("power", "USBLC6-2SC6", "ESD protection on USB D+ and D−",
           "The USB data lines go straight into the ESP32, and static from a finger or a cable could kill "
           "it. This chip diverts those zaps to ground."),
    "R1": ("power", "5.1 kΩ", "CC pull-down",
           "A USB-C charger only switches 5 V on when it sees this resistor on the CC wire. Without it, a "
           "USB-C charger would supply nothing."),
    "U2": ("power", "AP2112K-3.3 regulator", "5 V to 3.3 V, up to 600 mA",
           "The ESP32 runs at 3.3 V and USB supplies 5 V. A linear regulator is simple and quiet, but turns "
           "the 1.7 V difference into heat (about 0.2 W on average, 0.6 W in Wi-Fi bursts). It's the "
           "warmest part on the board, so the case has a vent above it."),
    "C1": ("power", "10 µF", "Regulator input",
           "A local reservoir, so the regulator doesn't see dips when the load jumps."),
    "C2": ("power", "10 µF", "Regulator output",
           "The regulator needs it to stay stable, and it supplies Wi-Fi's sudden current bursts."),
    "C3": ("power", "100 nF", "Regulator output",
           "Handles the high-frequency noise the larger capacitor is too slow for."),
    "U1": ("mcu", "ESP32-S3-MINI-1-N8 module", "The brain: Wi-Fi, CPU and 8 MB of flash",
           "A pre-certified module (radio, antenna and flash already designed and approved), so the board "
           "needs no RF design. It sits at the far end from the mains, with the antenna hanging off the "
           "edge, clear of copper that would detune it."),
    "C4": ("mcu", "10 µF", "Module 3V3 decoupling",
           "Wi-Fi bursts draw sharp current spikes. Capacitors at the module's power pin supply them "
           "instantly, so the voltage doesn't sag and crash the chip."),
    "C5": ("mcu", "100 nF", "Module 3V3 decoupling", "Partners C4 for the higher-frequency part of that noise."),
    "C6": ("mcu", "1 µF", "EN reset delay",
           "With R2, holds the chip in reset for a few milliseconds at power-up, until the supply is "
           "steady. Espressif's recommended values."),
    "R2": ("mcu", "10 kΩ", "EN pull-up", "Pulls the chip's enable pin high so it runs; with C6 it sets the start-up delay."),
    "SW2": ("ui", "MTS-103 ON-OFF-ON toggle", "Override: ON, AUTO or OFF",
            "A physical override that works with no Wi-Fi or cloud: up forces the heating on, down forces "
            "it off, and the centre lets the system decide. Its bushing comes through the lid."),
    "R9": ("ui", "10 kΩ", "Toggle 'on' pull-up (GPIO 13)",
           "Gives the input a defined high level; the switch pulls it to ground when selected."),
    "R10": ("ui", "10 kΩ", "Toggle 'off' pull-up (GPIO 14)",
            "The same for 'off'. With neither input pulled low, the firmware knows it's in AUTO."),
    "D1": ("ui", "WS2812B-2020 RGB LED", "Status LED, under a light pipe",
           "Shows heating, idle, fallback or no Wi-Fi at a glance: any colour from one part and one data pin."),
    "R6": ("ui", "330 Ω", "LED data resistor (GPIO 15)",
           "Damps ringing on the LED's fast data line and protects the GPIO."),
    "C8": ("ui", "100 nF", "LED decoupling",
           "The LED draws current in sharp pulses; this keeps them off the 3.3 V supply."),
    "SW1": ("ui", "TS-1187A button", "BOOT (GPIO 0)",
            "Holding BOOT at power-up starts the ESP32's built-in bootloader, so a board with broken "
            "firmware can always be reflashed over USB."),
    "R3": ("ui", "10 kΩ", "BOOT pull-up", "Keeps GPIO 0 high, so the board starts normally unless BOOT is pressed."),
    "J3": ("io", "DORABO 8-way 3.5 mm terminal", "5V, G, 3V3, SDA, SCL, GPIO 4/5/6",
           "Power, I²C and three GPIOs on screw terminals, for reusing spare boards. Keep loads small "
           "(about 100 mA from 3V3, 150 mA from 5V)."),
    "J4": ("io", "16-way boxed IDC header", "3V3, 5V, two GNDs and 12 GPIOs",
           "A keyed ribbon-cable header for reuse, with grounds between the signal groups to keep ribbon "
           "signals clean. The STAT-77 round display plugs in here."),
    "R4": ("io", "4.7 kΩ", "I²C SDA pull-up",
           "I²C devices only ever pull the lines low, so something has to pull them high. Fitting these "
           "means sensors just plug in."),
    "R5": ("io", "4.7 kΩ", "I²C SCL pull-up", "As R4, for the clock line."),
    "TP1": ("mech", "Debug pads", "3V3, G, TX, RX, EN",
            "A back door: if USB is ever unusable, a USB-serial adapter on these pads can still flash and "
            "debug the chip."),
    "H1": ("mech", "M3 hole, unplated", "Mounting, mains end",
           "Unplated with no copper, so a screw here connects to nothing. Use a nylon screw."),
    "H2": ("mech", "M3 hole, unplated", "Mounting, mains end",
           "As H1. A metal screw and washer here would sit within 3 mm of J2, so use nylon."),
    "H3": ("mech", "M3 hole, plated", "Mounting",
           "Plated and on GND, so a metal standoff here also grounds the board."),
    "H4": ("mech", "M3 hole, plated", "Mounting", "As H3."),
}

VENT = "U2"          # the warm part: the case vent goes above it
DOC = Path(__file__).resolve().parents[3] / "docs" / "heatlink-board-key.md"
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def board_frame(img):
    """(x0, y0, scale) mapping board mm to render pixels. KiCad renders onto a transparent
    background, so the board's left, top and bottom edges bound the opaque pixels (the antenna
    overhangs the right edge, so that one isn't used)."""
    x0, y0, _, y1 = img.getchannel("A").getbbox()
    return x0, y0, (y1 - y0) / hb.W


def _font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default(size)


def key_png(top_png, out_png, at=hb.AT, zoom=1.5, margin=24):
    """Numbered markers (coloured by group) on the top render, cropped to the board and enlarged,
    with a dashed ring where the case needs its vent."""
    render = Image.open(top_png).convert("RGBA")
    l, t, r, b = render.getchannel("A").getbbox()
    render = render.crop((l - margin, t - margin, r + margin, b + margin))
    render = render.resize((round(render.width * zoom), round(render.height * zoom)), Image.LANCZOS)
    x0, y0, s = board_frame(render)
    img = Image.new("RGB", render.size, "white")
    img.paste(render, mask=render)
    d = ImageDraw.Draw(img)
    rad = 9 * zoom
    vx, vy = x0 + at[VENT][0] * s, y0 + at[VENT][1] * s
    vr = 3.5 * s
    for a in range(0, 360, 20):              # dashed ring: 10° arcs
        d.arc((vx - vr, vy - vr, vx + vr, vy + vr), a, a + 10, fill="#f5a524", width=round(2 * zoom))
    # the label sits to the left, on the bare mains-area board, clear of the parts
    d.text((vx - vr - 6 * zoom, vy), "vent above U2", fill="#f5a524", font=_font(round(13 * zoom)), anchor="rm")
    f = _font(round(10 * zoom))
    for i, (ref, (g, *_)) in enumerate(KEY.items(), 1):
        cx, cy = x0 + at[ref][0] * s, y0 + at[ref][1] * s
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=GROUPS[g][0], outline="white", width=round(2 * zoom))
        d.text((cx, cy), str(i), fill="white", font=f, anchor="mm")
    img.save(out_png)
    return out_png


def key_md(image):
    """The markdown key: one table per block, numbered as on the diagram."""
    num = {ref: i for i, ref in enumerate(KEY, 1)}
    lines = ["# Nakostat heatlink board: component key", "",
             "<!-- Generated by pcb/heatlink/board/key.py (build.py, or `python -m board.key`). "
             "Edit the text there, not here. -->", "",
             "What every part on the heatlink board (STAT-75, `pcb/heatlink/`) does, and why it's there.", "",
             f"![The heatlink board, top view, with numbered parts]({image})", "",
             "Top view, 66 × 49 mm. The mains end (dashed outline) is on the left; the antenna overhangs the "
             "right edge. The dashed orange ring marks where the case needs a vent: above the regulator, U2.",
             ""]
    for g, (_, heading, intro) in GROUPS.items():
        lines += [f"## {heading}", "", intro, "", "| # | Ref | Part | What it does | Why it's there |",
                  "|---|---|---|---|---|"]
        lines += [f"| {num[r]} | {r} | {part} | {what} | {why} |"
                  for r, (grp, part, what, why) in KEY.items() if grp == g]
        lines.append("")
    lines.append("Chi's artwork, the credit and the board name are on the back, in silkscreen only.")
    return "\n".join(lines) + "\n"


def write_key(out_dir, stem, doc):
    """<stem>-key.png beside the renders, and the markdown key at doc, linking to it."""
    png = key_png(out_dir / f"{stem}-top.png", out_dir / f"{stem}-key.png")
    doc.write_text(key_md(Path(os.path.relpath(png, doc.parent)).as_posix()))
    return png


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent
    print(write_key(here / "out" / "heatlink", "nakostat-heatlink", DOC))
