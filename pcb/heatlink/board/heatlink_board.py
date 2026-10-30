"""Nakostat heatlink board (STAT-75): ESP32-S3-MINI-1 + a relay on the boiler's 230 V
ROOM STAT/TIMER pair + a 3-way toggle switch + a WS2812B, fed over the house USB cable on a
JST-SH socket. See DESIGN.md for the parts and the circuit.

Board frame (KiCad, y down): x 0..L, y 0..W. The mains end is x = 0 (it faces the PG7 gland):
the boiler terminals and the relay contacts are there, inside MAINS_X. Everything else is low
voltage and keeps 8 mm from mains copper (board/kicad_pcb.py DRU). The module sits at the other
end with its antenna overhanging the x = L edge, as far from the relay and the mains as the
board allows.
"""
import math

from board.kicad_pcb import Track, Via
from board.netlist import Circuit
from board.parts import ESP32_ANTENNA, part
from pathlib import Path

from board.placement import Placement, rotate

HERE = Path(__file__).resolve().parent.parent

W = 30.0
L = 66.0
CY = W / 2
MOD_ROT = 270                          # antenna (footprint -y) towards +x
MOD_X = L + ESP32_ANTENNA[3]           # 58.25: the antenna strip begins on the x = L edge
ANTENNA = -ESP32_ANTENNA[1] + ESP32_ANTENNA[3]   # 5.05 mm of overhang
MAINS_X = 28.5                         # low-voltage copper stays right of this line (8 mm rule + margin)

# GPIO choice. USB is fixed by the silicon; the relay, switch and LED take the module's inner
# edge (pads 16-19, which face the rest of the board); the button keeps GPIO0 (download strap).
# None is a strapping pin (3/45/46), a flash pin (26-32), an eFuse-dependent SPI pin (33-37) or
# an octal pin (47/48). At reset every one of them is an input, so the relay FET's 100k
# pull-down holds the relay off until the firmware drives it.
GPIO = {"RELAY": 12, "SW_ON": 13, "SW_OFF": 14, "LED": 15, "BUTTON": 0, "USB_DM": 19, "USB_DP": 20,
        "UART_TX": 43, "UART_RX": 44}
_MODPIN = {43: "TXD0", 44: "RXD0"}


def modpin(gpio):
    return _MODPIN.get(gpio, f"IO{gpio}")


# J1 (house USB, tinycrypt's J1): 1 VBUS, 2 D-, 3 D+, 4 CC, 5 GND; pads 6/7 are the shell tabs.
J1_PINS = {"1": "VBUS_IN", "2": "USB_DM", "3": "USB_DP", "4": "CC", "5": "GND"}
J1_LABELS = {"1": "V", "2": "D-", "3": "D+", "4": "CC", "5": "G"}
# J2 (boiler): the permanent live in, and the switched live back to the boiler. The relay just
# joins them, so the order does not matter electrically; the labels match the boiler's wiring.
J2_PINS = {"2": "MAINS_L", "1": "MAINS_SL"}
J2_LABELS = {"2": "L", "1": "SL"}
DEBUG_PINS = {"1": "EN", "2": "UART_RX", "3": "UART_TX", "4": "GND", "5": "+3V3"}
DEBUG_LABELS = {"1": "EN", "2": "RX", "3": "TX", "4": "G", "5": "3V3"}


def build_heatlink():
    c = Circuit()
    u1 = c.add("ESP32", "U1")
    u2 = c.add("LDO", "U2")
    u3 = c.add("ESD", "U3")
    j1 = c.add("JST5", "J1")
    j2 = c.add("TERM", "J2")
    k1 = c.add("RELAY", "K1")
    q1 = c.add("FET", "Q1")
    f1 = c.add("PTC", "F1")
    sw1 = c.add("SW", "SW1")
    sw2 = c.add("TOGGLE", "SW2")
    d1 = c.add("LED", "D1")
    d2 = c.add("TVS", "D2")
    d3 = c.add("DIODE", "D3")
    tp = c.add("DEBUG", "TP1")
    for ref in ("H1", "H2"):
        c.add("MHN", ref)
    for ref in ("H3", "H4"):
        c.add("MH", ref)
    gnd, v33, vbus = "GND", "+3V3", "VBUS"

    def cap(key, ref, net):
        k = c.add(key, ref)
        c.connect(net, (k, "1"))
        c.connect(gnd, (k, "2"))

    # USB in: J1 -> 500 mA PTC -> VBUS, clamped by the TVS (a reversed cable forward-biases it
    # and trips the PTC). D-/D+ through the USBLC6 (flow-through) to the module. CC: 5.1k Rd.
    for pad, net in J1_PINS.items():
        c.connect(net, (j1, pad))
    c.connect(gnd, (j1, "6"), (j1, "7"))
    c.connect("VBUS_IN", (f1, "1"))
    c.connect(vbus, (f1, "2"), (d2, "1"))            # D2 pad 1 = cathode
    c.connect(gnd, (d2, "2"))
    c.connect("USB_DM", (u3, "1"), (u3, "6"), (u1, modpin(GPIO["USB_DM"])))
    c.connect("USB_DP", (u3, "3"), (u3, "4"), (u1, modpin(GPIO["USB_DP"])))
    c.connect(vbus, (u3, "5"))
    c.connect(gnd, (u3, "2"))
    c.connect("CC", (c.add("R5K1", "R1"), "1"))
    c.connect(gnd, (c.instances["R1"], "2"))

    # 3.3 V: AP2112K, EN tied to VIN, 10 uF in, 10 uF + 100 nF out.
    c.connect(vbus, (u2, "VIN"), (u2, "EN"))
    c.connect(gnd, (u2, "GND"))
    c.connect(v33, (u2, "VOUT"))
    cap("C10U", "C1", vbus)
    cap("C10U", "C2", v33)
    cap("C100N", "C3", v33)

    # Module: 3V3 with 10 uF + 100 nF; EN RC (10k to 3V3, 1 uF to GND); every GND pad.
    c.connect(v33, (u1, "3V3"))
    c.connect(gnd, (u1, "GND"))
    cap("C10U", "C4", v33)
    cap("C100N", "C5", v33)
    c.connect("EN", (u1, "EN"), (c.add("R10K", "R2"), "1"), (c.add("C1U", "C6"), "1"))
    c.connect(v33, (c.instances["R2"], "2"))
    c.connect(gnd, (c.instances["C6"], "2"))

    # Button on GPIO0 (download strap; the firmware may use it too), 10k pull-up. Diagonal pads
    # B and C are on different contact bars whichever way the switch pairs them.
    c.connect("BUTTON", (u1, modpin(GPIO["BUTTON"])), (sw1, "B"), (c.add("R10K", "R3"), "1"))
    c.connect(v33, (c.instances["R3"], "2"))
    c.connect(gnd, (sw1, "C"))

    # Relay: 5 V coil (125 R, 40 mA) from VBUS, switched low-side by the AO3400A; 1N4148W
    # flyback across the coil; 100 R gate resistor and a 100k pull-down that keeps the relay off
    # while the chip is in reset or booting. Contacts (pads 3 and 4, SPST-NO) join the boiler's
    # live to its switched live: that is the call for heat.
    c.connect(vbus, (k1, "1"), (d3, "K"))
    c.connect("COIL", (k1, "2"), (d3, "A"), (q1, "D"))
    c.connect(gnd, (q1, "S"))
    r7, r8 = c.add("R100", "R7"), c.add("R100K", "R8")
    c.connect("RELAY_G", (q1, "G"), (r7, "1"), (r8, "1"))
    c.connect("RELAY", (r7, "2"), (u1, modpin(GPIO["RELAY"])))
    c.connect(gnd, (r8, "2"))
    for pad, net in J2_PINS.items():
        c.connect(net, (j2, pad))
    c.connect("MAINS_L", (k1, "4"))
    c.connect("MAINS_SL", (k1, "3"))

    # 3-way toggle (ON-OFF-ON): common (2) to GND, each throw to a GPIO with a 10k pull-up. The
    # middle position (neither throw) is auto.
    c.connect(gnd, (sw2, "2"))
    c.connect("SW_ON", (sw2, "1"), (u1, modpin(GPIO["SW_ON"])), (c.add("R10K", "R9"), "1"))
    c.connect("SW_OFF", (sw2, "3"), (u1, modpin(GPIO["SW_OFF"])), (c.add("R10K", "R10"), "1"))
    c.connect(v33, (c.instances["R9"], "2"), (c.instances["R10"], "2"))

    # WS2812B-2020: VDD 3V3 + 100 nF, DIN from a GPIO through 330R, DOUT unconnected.
    c.connect(v33, (d1, "VDD"))
    c.connect(gnd, (d1, "GND"))
    r6 = c.add("R330", "R6")
    c.connect("LED_DIN", (d1, "DI"), (r6, "1"))
    c.connect("LED", (r6, "2"), (u1, modpin(GPIO["LED"])))
    cap("C100N", "C8", v33)

    # Debug pads: EN, UART0 (GPIO43/44), GND, 3V3.
    c.connect("UART_TX", (u1, modpin(GPIO["UART_TX"])))
    c.connect("UART_RX", (u1, modpin(GPIO["UART_RX"])))
    for pad, net in DEBUG_PINS.items():
        c.connect(net, (tp, pad))

    # Mounting holes: the two on the low-voltage side are plated, on GND; the two in the mains
    # area are unplated and have no copper.
    c.connect(gnd, (c.instances["H3"], "1"), (c.instances["H4"], "1"))
    return c


# (x, y, rotation) of each part. Mains area (x < MAINS_X): J2 with its openings facing the
# x = 0 edge and the gland, the relay with its contacts towards J2 and its coil towards the low
# side, two unplated holes. Low-voltage side: the relay driver beside the coil, the button, the
# toggle (through the lid) with the LED beside it (a light pipe in the lid), the USB socket on
# the y = W edge with its protection and the regulator, then the module.
AT = {
    "U1": (MOD_X, CY, MOD_ROT),
    "H1": (3.5, 3.5, 0), "H2": (3.5, 26.5, 0), "H3": (62.5, 3.5, 0), "H4": (62.5, 26.5, 0),
    "J2": (6.5, 17.0, 90), "K1": (22.0, 6.5, 180),
    # relay driver, beside the coil pads (x 31.25)
    "D3": (35.0, 6.5, 90), "Q1": (38.5, 5.5, 0), "R7": (41.5, 4.5, 0), "R8": (41.5, 6.5, 0),
    # button and the module's 3V3 decoupling, above the module
    "SW1": (46.5, 4.5, 0), "R3": (52.0, 2.0, 0), "C4": (55.0, 4.5, 0), "C5": (57.5, 5.5, 90),
    # toggle switch, LED and pull-ups
    "SW2": (38.0, 16.0, 0), "D1": (47.2, 12.5, 0), "R6": (47.5, 10.2, 0), "C8": (50.0, 12.5, 90),
    "R9": (47.5, 17.0, 90), "R10": (47.5, 20.0, 90),
    # power in: PTC, TVS, regulator and its caps, USB socket and ESD
    "C1": (30.5, 23.0, 90), "U2": (33.5, 23.0, 0), "C2": (36.5, 22.5, 90), "C3": (36.5, 25.5, 90),
    "D2": (33.0, 26.2, 0), "F1": (33.0, 28.6, 0), "R1": (45.6, 22.6, 90),
    "J1": (42.0, round(W - 3.21, 2), 0), "U3": (42.0, 22.0, 0),
    # EN RC and the debug pads, below the module
    "R2": (57.5, 24.3, 0), "C6": (55.5, 24.3, 0), "TP1": (53.0, 27.3, 270),
}


def place_heatlink(circuit):
    at = {r: AT[r] for r in circuit.instances}
    bodies = {r: i.part.body for r, i in circuit.instances.items()}
    return Placement((0.0, 0.0, L, W), at, bodies)


def mains_area():
    """The mains area as a polygon: every low-voltage item stays out of it."""
    return [(0.0, 0.0), (MAINS_X, 0.0), (MAINS_X, W), (0.0, W)]


def keepouts():
    """No ground pour in the mains area (its own tracks and pads are allowed)."""
    return [("mains", mains_area(), ("F.Cu", "B.Cu"), True)]


def route_area():
    """The router works only on the low-voltage side (the mains tracks are routed by hand), and
    keeps EDGE_INSET from the long edges and the antenna end, so its tracks clear the board
    edge (0.3 mm) once read_ses() widens them."""
    e = EDGE_INSET
    return [(MAINS_X, e), (L - e, e), (L - e, W - e), (MAINS_X, W - e)]


EDGE_INSET = 0.45


def layer_keepouts():
    return []


_KEY = {}


def pad_xy(ref, number, circuit=None):
    """Exact board position of a pad centre."""
    x, y, rot = AT[ref]
    key = _KEY.get(ref) or (circuit.instances[ref].part.key if circuit else None)
    fp = part(key).footprint
    q = next(q for q in fp.pads if q.number == number)
    dx, dy = rotate(q.x, q.y, rot)
    return round(x + dx, 4), round(y + dy, 4)


def _segments(net, layer, pts, width):
    return [Track(net, layer, a, b, c, d, width) for (a, b), (c, d) in zip(pts, pts[1:]) if (a, b) != (c, d)]


MAINS_W = 1.2         # mains tracks: the call-for-heat current is milliamps; width is for robustness


def mains_hand_route():
    """(tracks, vias) for the two mains nets, F.Cu only: J2 -> relay contacts. MAINS_L runs up
    from J2's upper pin and across to pad 4; MAINS_SL along y = J2's lower pin to x of pad 3,
    then up. They stay at least MAINS_FUNCTIONAL apart."""
    _KEY.update({"J2": "TERM", "K1": "RELAY"})
    jl, jsl = pad_xy("J2", "2"), pad_xy("J2", "1")
    k4, k3 = pad_xy("K1", "4"), pad_xy("K1", "3")
    t = _segments("MAINS_L", "F.Cu", [jl, (jl[0], 11.0), (k4[0], 11.0 - (k4[0] - jl[0])), k4], MAINS_W)
    t += _segments("MAINS_SL", "F.Cu", [jsl, (k3[0], jsl[1]), k3], MAINS_W)
    return t, []


TITLE = "nakostat heatlink v0.1"
CREDIT = "Designed by Nakomis/C"
CAT = "Chi"
ART_PNG = HERE / "art" / "chi.png"
ART_PX = 0.16                         # mm per pixel: 150 x 123 px -> 24.0 x 19.7 mm
ART_X, ART_TOP = 35.0, 0.8            # top-view position of the portrait's top-left corner
HOLE_CLEAR = 3.0 + 0.25               # no silk over H3's plated ring
BACK_TEXT_X = 47.0                    # centre of the back text, under the portrait
BACK_TEXT = ((CAT, 1.2, 22.0), (CREDIT, 1.0, 24.0), (TITLE, 1.0, 25.8))


def art_heatlink():
    """Chi on the back, over the low-voltage side (house rule). The pixels over H3's ring and
    over through-hole pads are dropped."""
    from PIL import Image
    h = Image.open(ART_PNG).size[1]
    holes = [(AT[r][0], AT[r][1], HOLE_CLEAR) for r in ("H3", "H4")]
    # and the through-hole pads that come through to the back under her: the toggle's three and
    # the relay's coil pins (silk over a pad is clipped by the fab anyway)
    _KEY.update({"SW2": "TOGGLE", "K1": "RELAY"})
    holes += [(*pad_xy("SW2", n), 1.9) for n in "123"] + [(*pad_xy("K1", n), 1.3) for n in "12"]
    return [(ART_PNG, ART_X, ART_TOP, round(h * ART_PX, 3), "back", holes)]


def on_art(x, y, margin=0.45):
    """True if a via at board (x, y) would land on (or within 'margin' of) a white silk pixel of
    the back portrait. Stitching vias keep to the dark areas, so they don't pit Chi's fur."""
    from PIL import Image
    img = Image.open(ART_PNG).convert("L")
    w, h = img.width * ART_PX, img.height * ART_PX
    px = img.load()
    for ddx in (-margin, 0.0, margin):
        for ddy in (-margin, 0.0, margin):
            lx, ly = x + ddx - ART_X, y + ddy - ART_TOP
            if 0 <= lx < w and 0 <= ly < h:
                col = int((w - lx) / ART_PX)          # mirrored: the art is on the back
                row = int(ly / ART_PX)
                if 0 <= col < img.width and 0 <= row < img.height and px[col, row] >= 128:
                    return True
    return False


def silk(circuit, placement):
    """Silk entries (text, x, y, size[, layer, rotation])."""
    _KEY.update({r: i.part.key for r, i in circuit.instances.items()})
    out = []
    for n, text in J2_LABELS.items():
        x, y = pad_xy("J2", n)
        out.append((text, round(x - 3.6, 3), round(y, 3), 1.2))
    out += [("230 V", 17.0, 14.5, 2.0), ("MAINS", 17.0, 17.5, 1.5),
            ("230 V MAINS", 13.0, 24.0, 1.5, "B.SilkS")]
    for n, text in J1_LABELS.items():
        x, y = pad_xy("J1", n)
        out.append((text, round(x, 3), round(y - 1.6, 3), 0.7, "F.SilkS", 90))
    for n, text in DEBUG_LABELS.items():
        x, y = pad_xy("TP1", n)
        out.append((text, round(x, 3), round(y - 1.6, 3), 0.8))
    sx, sy, _ = placement.at["SW2"]
    out += [("ON", round(sx - 4.7, 3), round(sy - 5.0, 3), 1.0), ("AUTO", sx, round(sy - 5.0, 3), 1.0),
            ("OFF", round(sx + 4.7, 3), round(sy - 5.0, 3), 1.0)]
    bx, by, _ = placement.at["SW1"]
    out.append(("BOOT", bx, round(by + 3.6, 3), 0.8))
    out += [(t, BACK_TEXT_X, y, size, "B.SilkS") for t, size, y in BACK_TEXT]
    return out


def boundary():
    """The mains boundary, drawn on both silkscreens (dashed)."""
    return [(0.4, 0.4, MAINS_X - 3.0, W - 0.4, "F.SilkS"), (0.4, 0.4, MAINS_X - 3.0, W - 0.4, "B.SilkS")]


def fab_notes():
    """(text entries, user rectangles) on Dwgs.User: the antenna overhang, and the mains area."""
    x0, x1 = CY - 7.7, CY + 7.7
    text = [("MODULE ANTENNA OVERHANGS THIS EDGE BY 5.05 mm: INTENTIONAL", L + 2.5, CY, 0.6, "Dwgs.User", 90),
            ("230 V AC: KEEP 8 mm FROM LOW VOLTAGE", MAINS_X / 2, -1.5, 0.8, "Dwgs.User")]
    return text, [(L, x0, L + ANTENNA, x1, "Dwgs.User")]


def pad_extra(circuit):
    """Per-pad additions. U1's nine 1.2 mm centre GND pads get a -0.18 mm paste margin (about
    49 % coverage; Espressif warns that a full thermal pad lifts the module). Every SMD GND pad
    joins the pour solidly rather than through thermal spokes: the parts are reflowed, and the
    small pads (SOT-23, 0402) otherwise get one spoke where tracks hem them in. So do the plated
    mounting-hole rings, which would otherwise leave the board corners beyond them unjoined."""
    from board.sexpr import Sym

    def make(ref):
        def f(pad):
            extra = []
            if ref == "U1" and pad.number == "GND" and abs(pad.w - 1.2) < 1e-6:
                extra.append([Sym("solder_paste_margin"), -0.18])
            if (pad.kind == "smd" or ref in ("H3", "H4")) and circuit.net_of(ref, pad.number) == "GND":
                extra.append([Sym("zone_connect"), 2])
            return extra
        return f
    return {ref: make(ref) for ref in circuit.instances}


def pins_h():
    """The firmware header: GPIO numbers as wired on this board."""
    lines = ["/* Generated by pcb/heatlink/build.py from board/heatlink_board.py: do not edit. */",
             "#pragma once", "",
             "/* Debug pads TP1, from the antenna end: " + ", ".join(DEBUG_LABELS.values()) + ".",
             "   EN is the chip enable (bridge it to G to reset); RX/TX are UART0. */",
             "/* The relay is active-high (low-side FET), the switch throws are active-low. */", ""]
    for k in ("RELAY", "SW_ON", "SW_OFF", "LED", "BUTTON", "USB_DM", "USB_DP", "UART_TX", "UART_RX"):
        lines.append(f"#define HL_PIN_{k} {GPIO[k]}")
    return "\n".join(lines) + "\n"


def _pad_boxes(circuit, placement):
    """(net, xmin, ymin, xmax, ymax) for every copper pad, in board coordinates."""
    out = []
    for ref, inst in circuit.instances.items():
        x, y, rot = placement.at[ref]
        for pad in inst.part.footprint.pads:
            dx, dy = rotate(pad.x, pad.y, rot)
            w, h = (pad.h, pad.w) if round(pad.rot + rot) % 180 == 90 else (pad.w, pad.h)
            out.append((circuit.net_of(ref, pad.number), x + dx - w / 2, y + dy - h / 2,
                        x + dx + w / 2, y + dy + h / 2))
    return out


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = 0.0 if vx == vy == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - ax - t * vx, py - ay - t * vy)


def _box_dist(x, y, box):
    _, x0, y0, x1, y1 = box
    return math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))


def stitch_vias(circuit, placement, tracks, vias, pitch=2.0, clear=0.5):
    """GND stitching vias on a grid over the low-voltage side, wherever a via clears every pad,
    track and via by 'clear' (beyond its own 0.3 mm radius) so that both pours reach it. None
    within 1 mm of the mains boundary or under the module's antenna end."""
    pads = _pad_boxes(circuit, placement)
    placed = list(vias)
    out = []
    r = 0.3
    y = 1.0
    while y < W - 0.9:
        x = MAINS_X + 1.5
        while x < L - 0.9:
            ok = all(_box_dist(x, y, b) >= r + clear for b in pads)
            ok = ok and all(_seg_dist(x, y, t.x1, t.y1, t.x2, t.y2) >= r + t.width / 2 + clear for t in tracks)
            ok = ok and all(math.hypot(x - v.x, y - v.y) >= 1.5 for v in placed)
            ok = ok and not on_art(x, y) and not under_back_text(x, y)
            if ok:
                v = Via("GND", round(x, 3), round(y, 3))
                out.append(v)
                placed.append(v)
            x += pitch
        y += pitch
    return out


MISSED = []        # GND pads gnd_drops() found no spot for


def gnd_drops(circuit, placement, tracks, vias, clear=0.2, skip=("U1",)):
    """(tracks, vias): a via beside every SMD GND pad, joined to it by a short track, so that each
    reaches the B.Cu pour even where routed tracks wall it off from the F.Cu pour. The via goes
    at the first free spot (clearing every other pad, track and via by 'clear') on rings 1.0 to
    3.0 mm from the pad centre."""
    pads = _pad_boxes(circuit, placement)
    placed, out_t, out_v = list(vias), [], []
    lines = list(tracks)
    r = 0.3
    for ref, inst in circuit.instances.items():
        if ref in skip:
            continue
        x, y, rot = placement.at[ref]
        for pad in inst.part.footprint.pads:
            if pad.kind != "smd" or circuit.net_of(ref, pad.number) != "GND":
                continue
            dx, dy = rotate(pad.x, pad.y, rot)
            px, py = x + dx, y + dy
            spot = None
            for dist in (1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.3, 2.6, 3.0):
                for k in range(24):
                    a = 2 * math.pi * k / 24
                    vx, vy = px + dist * math.cos(a), py + dist * math.sin(a)
                    if not (MAINS_X + 0.5 < vx < L - 0.8 and 0.8 < vy < W - 0.8) or under_back_text(vx, vy):
                        continue
                    ok = all(b[0] == "GND" or _box_dist(vx, vy, b) >= r + clear for b in pads)
                    ok = ok and all(t.net == "GND" or _seg_dist(vx, vy, t.x1, t.y1, t.x2, t.y2) >= r + t.width / 2 + clear
                                    for t in lines)
                    ok = ok and all(math.hypot(vx - v.x, vy - v.y) >= 0.8 for v in placed)
                    # the joining track must clear other nets too
                    ok = ok and all(b[0] == "GND" or _seg_box_clear(px, py, vx, vy, b, 0.15 + clear) for b in pads)
                    ok = ok and all(t.net == "GND" or _seg_seg_dist(px, py, vx, vy, t) >= 0.15 + t.width / 2 + clear
                                    for t in lines)
                    if ok:
                        spot = (round(vx, 3), round(vy, 3))
                        break
                if spot:
                    break
            if spot is None:
                MISSED.append(f"{ref}.{pad.number}")
                continue
            v = Via("GND", *spot)
            t = Track("GND", "F.Cu", round(px, 4), round(py, 4), spot[0], spot[1], 0.3)
            placed.append(v)
            out_v.append(v)
            out_t.append(t)
            lines.append(t)
    return out_t, out_v


def _seg_box_clear(ax, ay, bx, by, box, d):
    """True if segment a-b stays at least d from the box (sampled)."""
    for i in range(21):
        x, y = ax + (bx - ax) * i / 20, ay + (by - ay) * i / 20
        if _box_dist(x, y, box) < d:
            return False
    return True


def _seg_seg_dist(ax, ay, bx, by, t):
    return min(_seg_dist(ax + (bx - ax) * i / 20, ay + (by - ay) * i / 20, t.x1, t.y1, t.x2, t.y2) for i in range(21))



def under_back_text(x, y, r=0.5):
    """True if a via at (x, y) would touch the back text (a tented via still shows through it)."""
    for t, size, ty in BACK_TEXT:
        w, h = 0.86 * size * len(t) + 0.15, 1.2 * size
        if abs(x - BACK_TEXT_X) <= w / 2 + r and abs(y - ty) <= h / 2 + r:
            return True
    return False


def back_text_boxes(r=0.1):
    """(x0, y0, x1, y1) of the back text, grown by r: the router places no via in them."""
    out = []
    for t, size, ty in BACK_TEXT:
        w, h = 0.86 * size * len(t) + 0.15, 1.2 * size
        out.append((BACK_TEXT_X - w / 2 - r, ty - h / 2 - r, BACK_TEXT_X + w / 2 + r, ty + h / 2 + r))
    return out
