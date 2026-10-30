"""The heatlink board (board/heatlink_board.py): netlist, GPIO choice, placement, mains spacing,
and the fab outputs that depend on them."""
import csv
import itertools
import json
import math
import re
import subprocess

import pytest
from conftest import KICAD_CLI

from board import heatlink_board as hb
from board.fab import write_bom_pcbway
from board.kicad_pcb import MAINS_EDGE, MAINS_FUNCTIONAL, MAINS_REINFORCED, DRU, write_board
from board.netlist import Circuit, check
from board.parts import ESP32_ANTENNA
from board.placement import Placement, bbox, rotate

C = hb.build_heatlink()
P = hb.place_heatlink(C)
EPS = 1e-6


def pad_of(ref, pin):
    """The (first) pad number behind a pin name."""
    return C.instances[ref].part.pins[pin][0]


def net(ref, pin):
    return C.net_of(ref, pad_of(ref, pin))


def module_net(gpio):
    return net("U1", hb.modpin(gpio))


# ---------------------------------------------------------------- netlist

def test_netlist_check_is_clean():
    assert check(C) == []


def test_usb_data_goes_through_the_esd_chip_to_gpio19_20():
    assert (hb.GPIO["USB_DM"], hb.GPIO["USB_DP"]) == (19, 20)
    # USBLC6 is flow-through: D- on pads 1 and 6, D+ on pads 3 and 4; the module is on the same nets
    assert {net("U3", p) for p in ("1", "6")} == {"USB_DM"}
    assert {net("U3", p) for p in ("3", "4")} == {"USB_DP"}
    assert module_net(19) == "USB_DM" and module_net(20) == "USB_DP"
    assert ("J1", "2") in C.nets["USB_DM"] and ("J1", "3") in C.nets["USB_DP"]
    assert net("U3", "2") == "GND" and net("U3", "5") == "VBUS"


def test_j1_pinout_and_power_input():
    assert [net("J1", str(n)) for n in range(1, 6)] == ["VBUS_IN", "USB_DM", "USB_DP", "CC", "GND"]
    assert net("J1", "6") == net("J1", "7") == "GND"          # shell tabs
    # CC: 5.1k Rd to GND (the house cable carries CC through)
    assert net("R1", "1") == "CC" and net("R1", "2") == "GND"
    assert C.instances["R1"].value == "5k1"
    # VBUS_IN -> PTC F1 -> VBUS
    assert net("F1", "1") == "VBUS_IN" and net("F1", "2") == "VBUS"
    # TVS D2: cathode (pad 1) on VBUS, anode on GND
    assert net("D2", "1") == "VBUS" and net("D2", "2") == "GND"


def test_relay_coil_driver():
    assert net("K1", "1") == "VBUS" and net("K1", "2") == "COIL"
    # flyback D3 across the coil: cathode on VBUS, anode on COIL; low-side FET drain on COIL
    assert net("D3", "K") == "VBUS" and net("D3", "A") == "COIL"
    assert net("Q1", "D") == "COIL" and net("Q1", "S") == "GND"
    # gate: 100k pull-down, 100R from the module's GPIO12 pad
    assert net("Q1", "G") == "RELAY_G"
    assert net("R8", "1") == "RELAY_G" and net("R8", "2") == "GND" and C.instances["R8"].value == "100k"
    assert net("R7", "1") == "RELAY_G" and net("R7", "2") == "RELAY" and C.instances["R7"].value == "100R"
    assert hb.GPIO["RELAY"] == 12 and module_net(12) == "RELAY"
    assert C.net_of("U1", "16") == "RELAY"                     # GPIO12 is module pad 16


def test_relay_contacts_join_the_boiler_live_to_switched_live():
    assert net("K1", "4") == "MAINS_L" and net("K1", "3") == "MAINS_SL"
    assert {net("J2", "1"), net("J2", "2")} == {"MAINS_L", "MAINS_SL"}
    assert {n for n in C.nets if n.startswith("MAINS_")} == {"MAINS_L", "MAINS_SL"}
    # nothing else touches the mains nets
    assert {r for n in ("MAINS_L", "MAINS_SL") for r, _ in C.nets[n]} == {"K1", "J2"}


def test_toggle_switch_common_to_gnd_and_throws_to_gpio13_14():
    assert net("SW2", "2") == "GND"
    assert net("SW2", "1") == "SW_ON" and net("SW2", "3") == "SW_OFF"
    assert module_net(13) == "SW_ON" and module_net(14) == "SW_OFF"
    assert (hb.GPIO["SW_ON"], hb.GPIO["SW_OFF"]) == (13, 14)
    for r, n in (("R9", "SW_ON"), ("R10", "SW_OFF")):
        assert net(r, "1") == n and net(r, "2") == "+3V3" and C.instances[r].value == "10k"


def test_led_on_gpio15_through_330r():
    assert hb.GPIO["LED"] == 15 and module_net(15) == "LED"
    assert net("R6", "2") == "LED" and net("R6", "1") == "LED_DIN"
    assert C.instances["R6"].value == "330R"
    assert net("D1", "DI") == "LED_DIN" and net("D1", "VDD") == "+3V3" and net("D1", "GND") == "GND"


def test_button_on_gpio0():
    assert hb.GPIO["BUTTON"] == 0 and module_net(0) == "BUTTON"
    assert net("SW1", "B") == "BUTTON" and net("SW1", "C") == "GND"
    assert net("R3", "1") == "BUTTON" and net("R3", "2") == "+3V3"


def test_debug_pads_and_regulator():
    assert [net("TP1", str(n)) for n in range(1, 6)] == ["EN", "UART_RX", "UART_TX", "GND", "+3V3"]
    assert module_net(43) == "UART_TX" and module_net(44) == "UART_RX"
    assert net("U2", "VIN") == net("U2", "EN") == "VBUS" and net("U2", "VOUT") == "+3V3"
    assert net("H3", "1") == net("H4", "1") == "GND"


def test_no_gpio_is_a_forbidden_pin():
    """Strapping pins (3, 45, 46) are never used, GPIO0 only for the boot button, and the flash
    (26-32), eFuse-dependent SPI (33-37) and octal (47, 48) pins not at all."""
    forbidden = {3, 45, 46, 47, 48} | set(range(26, 38))
    used = set(hb.GPIO.values())
    assert not used & forbidden, used & forbidden
    assert [k for k, v in hb.GPIO.items() if v == 0] == ["BUTTON"]
    assert len(used) == len(hb.GPIO)                           # no GPIO twice
    # and what the netlist actually wires to the module is the same set
    wired = {int(m.group(1)) for r, pad in C.nets.get("RELAY", ()) | C.nets["BUTTON"] | C.nets["LED"]
             | C.nets["SW_ON"] | C.nets["SW_OFF"] | C.nets["USB_DM"] | C.nets["USB_DP"] if r == "U1"
             for name, pads in C.instances["U1"].part.pins.items() if pad in pads
             and (m := re.fullmatch(r"IO(\d+)", name))}
    assert wired == {0, 12, 13, 14, 15, 19, 20}


def test_pins_h_defines_the_gpio_numbers():
    text = hb.pins_h()
    assert "#pragma once" in text
    for k, v in hb.GPIO.items():
        assert re.search(rf"^#define HL_PIN_{k} {v}$", text, re.M), k
    assert "#define HL_PIN_RELAY 12" in text and "#define HL_PIN_SW_ON 13" in text
    assert "#define HL_PIN_BUTTON 0" in text


# ---------------------------------------------------------------- placement

def test_board_size_and_outline():
    assert (hb.W, hb.L) == (30, 66)
    assert P.outline == (0.0, 0.0, hb.L, hb.W)
    assert set(P.at) == set(C.instances)


def test_every_part_but_the_module_is_inside_the_outline():
    x0, y0, x1, y1 = P.outline
    for ref in C.instances:
        if ref == "U1":
            continue
        b = bbox(P, ref)
        assert x0 - EPS <= b[0] and b[2] <= x1 + EPS and y0 - EPS <= b[1] and b[3] <= y1 + EPS, (ref, b)


def test_courtyards_do_not_overlap():
    boxes = {ref: bbox(P, ref) for ref in C.instances}
    for (a, ba), (b, bb) in itertools.combinations(boxes.items(), 2):
        overlap = ba[0] < bb[2] - EPS and bb[0] < ba[2] - EPS and ba[1] < bb[3] - EPS and bb[1] < ba[3] - EPS
        assert not overlap, (a, ba, b, bb)


def test_module_antenna_overhangs_the_x_equals_l_edge_only():
    corners = [rotate(x, y, hb.MOD_ROT) for x in (ESP32_ANTENNA[0], ESP32_ANTENNA[2])
               for y in (ESP32_ANTENNA[1], ESP32_ANTENNA[3])]
    xs = [hb.MOD_X + c[0] for c in corners]
    ys = [hb.CY + c[1] for c in corners]
    assert abs(min(xs) - hb.L) < EPS                         # the strip begins on the edge
    assert abs(max(xs) - (hb.L + hb.ANTENNA)) < EPS
    assert abs(hb.ANTENNA - 5.05) < 1e-9
    assert min(ys) >= 0 and max(ys) <= hb.W                  # within the board's width
    x, y, rot = P.at["U1"]
    assert (x, y, rot) == (hb.MOD_X, hb.CY, hb.MOD_ROT)
    # every module pad is on the board; only the antenna overhangs
    for pad in C.instances["U1"].part.footprint.pads:
        dx, dy = rotate(pad.x, pad.y, rot)
        assert 0 < x + dx < hb.L and 0 < y + dy < hb.W, pad.number


def test_fab_note_marks_the_overhang():
    text, rects = hb.fab_notes()
    assert len(rects) == 1 and rects[0][4] == "Dwgs.User"
    x0, _, x1, _, _ = rects[0]
    assert x0 == hb.L and abs(x1 - (hb.L + hb.ANTENNA)) < EPS
    assert any("INTENTIONAL" in t[0] for t in text)


def test_keepouts_are_one_pour_only_rule_area_over_the_mains_region():
    (name, pts, layers, pour_only), = hb.keepouts()
    assert pour_only is True and tuple(layers) == ("F.Cu", "B.Cu")
    xs = [p[0] for p in pts]
    assert min(xs) == 0 and max(xs) == hb.MAINS_X
    assert hb.layer_keepouts() == []


def test_route_area_is_the_low_voltage_side():
    xs = [p[0] for p in hb.route_area()]
    ys = [p[1] for p in hb.route_area()]
    assert min(xs) == hb.MAINS_X and max(xs) <= hb.L - hb.EDGE_INSET + EPS
    assert min(ys) >= hb.EDGE_INSET and max(ys) <= hb.W - hb.EDGE_INSET


def test_silk_labels_are_on_the_board_and_the_boundary_is_drawn_on_both_sides():
    for entry in hb.silk(C, P):
        assert 0 <= entry[1] <= hb.L and -2 <= entry[2] <= hb.W, entry
    assert {b[4] for b in hb.boundary()} == {"F.SilkS", "B.SilkS"}
    assert all(b[2] < hb.MAINS_X for b in hb.boundary())


# ---------------------------------------------------------------- mains spacing

def pad_boxes():
    """(ref, number, net, kind, (x0, y0, x1, y1)) for every pad in board coordinates."""
    out = []
    for ref, inst in C.instances.items():
        x, y, rot = P.at[ref]
        for pad in inst.part.footprint.pads:
            dx, dy = rotate(pad.x, pad.y, rot)
            w, h = (pad.h, pad.w) if round(pad.rot + rot) % 180 == 90 else (pad.w, pad.h)
            out.append((ref, pad.number, C.net_of(ref, pad.number), pad.kind,
                        (x + dx - w / 2, y + dy - h / 2, x + dx + w / 2, y + dy + h / 2)))
    return out


def box_gap(a, b):
    return math.hypot(max(a[0] - b[2], b[0] - a[2], 0), max(a[1] - b[3], b[1] - a[3], 0))


def is_mains(n):
    return bool(n) and n.startswith("MAINS_")


PADS = pad_boxes()
MAINS_PADS = [p for p in PADS if is_mains(p[2])]
LV_PADS = [p for p in PADS if p[2] and not is_mains(p[2])]


def test_mains_pads_are_the_relay_contacts_and_the_boiler_terminal():
    assert {(p[0], p[1]) for p in MAINS_PADS} == {("K1", "3"), ("K1", "4"), ("J2", "1"), ("J2", "2")}


def test_mains_pads_left_of_mains_x_and_low_voltage_pads_right_of_it():
    for ref, num, n, kind, b in MAINS_PADS:
        assert b[2] <= hb.MAINS_X, (ref, num, b)
    for ref, num, n, kind, b in LV_PADS:
        assert b[0] >= hb.MAINS_X, (ref, num, b)


def test_mains_pads_keep_reinforced_clearance_from_every_other_pad():
    for m in MAINS_PADS:
        for o in PADS:
            if is_mains(o[2]) or (o[0], o[1]) == (m[0], m[1]):
                continue
            if o[3] == "np_thru_hole":                         # unplated hole: the 3 mm hole rule
                assert box_gap(m[4], o[4]) >= MAINS_EDGE      # o's box is the hole's own bounding box, (m[:2], o[:2])
                continue
            assert box_gap(m[4], o[4]) >= MAINS_REINFORCED, (m[:2], o[:2], box_gap(m[4], o[4]))


def test_mains_pads_of_different_nets_keep_functional_clearance():
    for a, b in itertools.combinations(MAINS_PADS, 2):
        if a[2] != b[2]:
            assert box_gap(a[4], b[4]) >= MAINS_FUNCTIONAL, (a[:2], b[:2], box_gap(a[4], b[4]))


def test_mains_pads_keep_the_edge_distance_from_the_board_outline():
    for ref, num, n, kind, (x0, y0, x1, y1) in MAINS_PADS:
        assert min(x0, y0, hb.L - x1, hb.W - y1) >= MAINS_EDGE, (ref, num)


def seg_point(px, py, t):
    vx, vy = t.x2 - t.x1, t.y2 - t.y1
    s = 0.0 if vx == vy == 0 else max(0.0, min(1.0, ((px - t.x1) * vx + (py - t.y1) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - t.x1 - s * vx, py - t.y1 - s * vy)


def samples(t, n=400):
    return [(t.x1 + (t.x2 - t.x1) * i / n, t.y1 + (t.y2 - t.y1) * i / n) for i in range(n + 1)]


def seg_seg_gap(a, b):
    """Edge-to-edge distance between two track segments (sampled: accurate to a few microns)."""
    d = min(min(seg_point(x, y, b) for x, y in samples(a)), min(seg_point(x, y, a) for x, y in samples(b)))
    return d - a.width / 2 - b.width / 2


def seg_box_gap(t, box):
    d = min(math.hypot(max(box[0] - x, 0, x - box[2]), max(box[1] - y, 0, y - box[3])) for x, y in samples(t))
    return d - t.width / 2


TRACKS, VIAS = hb.mains_hand_route()


def test_mains_hand_route_is_the_two_mains_nets_on_the_top_layer_only():
    assert TRACKS and VIAS == []
    assert {t.net for t in TRACKS} == {"MAINS_L", "MAINS_SL"}
    assert {t.layer for t in TRACKS} == {"F.Cu"}


def test_mains_tracks_reach_their_pads():
    for n in ("MAINS_L", "MAINS_SL"):
        ends = {(round(t.x1, 3), round(t.y1, 3)) for t in TRACKS if t.net == n} \
            | {(round(t.x2, 3), round(t.y2, 3)) for t in TRACKS if t.net == n}
        for ref, num in sorted(C.nets[n]):
            assert (round(hb.pad_xy(ref, num, C)[0], 3), round(hb.pad_xy(ref, num, C)[1], 3)) in ends, (n, ref, num)


def test_mains_tracks_keep_functional_clearance_from_each_other():
    for a, b in itertools.combinations(TRACKS, 2):
        if a.net != b.net:
            assert seg_seg_gap(a, b) >= MAINS_FUNCTIONAL - 0.01, (a, b, seg_seg_gap(a, b))


def test_mains_tracks_keep_reinforced_clearance_from_non_mains_pads():
    for t in TRACKS:
        for ref, num, n, kind, b in PADS:
            if kind == "np_thru_hole":
                assert seg_box_gap(t, b) >= MAINS_EDGE - 0.01, (t.net, ref)
            elif not is_mains(n):
                assert seg_box_gap(t, b) >= MAINS_REINFORCED - 0.01, (t.net, ref, num, seg_box_gap(t, b))
            elif n != t.net:
                assert seg_box_gap(t, b) >= MAINS_FUNCTIONAL - 0.01, (t.net, ref, num)


def test_mains_tracks_stay_inside_the_mains_area_and_off_the_edges():
    for t in TRACKS:
        for x, y in ((t.x1, t.y1), (t.x2, t.y2)):
            assert MAINS_EDGE <= x <= hb.MAINS_X and MAINS_EDGE <= y <= hb.W - MAINS_EDGE, (t, x, y)


# ---------------------------------------------------------------- the DRU and KiCad's DRC

def test_dru_has_the_mains_rules(tmp_path):
    c = hb.build_heatlink()
    pcb = tmp_path / "h.kicad_pcb"
    write_board(c, hb.place_heatlink(c), pcb, layers=2)
    dru = pcb.with_suffix(".kicad_dru").read_text()
    assert dru == DRU
    assert dru.startswith("(version 1)")
    for rule in ("mains to low voltage", "mains to ground pour", "mains to mains", "mains to edge",
                 "mains to holes"):
        assert f'(rule "{rule}"' in dru
    assert f"(constraint clearance (min {MAINS_REINFORCED}mm))" in dru
    assert f"(constraint clearance (min {MAINS_FUNCTIONAL}mm))" in dru
    assert f"(constraint edge_clearance (min {MAINS_EDGE}mm))" in dru
    assert f"(constraint hole_clearance (min {MAINS_EDGE}mm))" in dru
    assert "hasNetclass('Mains')" in dru
    assert (MAINS_FUNCTIONAL, MAINS_REINFORCED, MAINS_EDGE) == (2.5, 8.0, 3.0)


def _synthetic_drc(tmp_path, gap, second_mains=False):
    """Two 0402 capacitors 'gap' mm apart (centre to centre), the left on a MAINS_ net, the right
    on a plain net (or on a second mains net); run KiCad DRC and return its violations."""
    c = Circuit()
    a, b = c.add("C100N", "C1"), c.add("C100N", "C2")
    c.connect("MAINS_A", (a, "1"), (a, "2"))
    other = "MAINS_B" if second_mains else "SIG"
    c.connect(other, (b, "1"), (b, "2"))
    pl = Placement((0.0, 0.0, 40.0, 20.0), {"C1": (15.0, 10.0, 0.0), "C2": (15.0 + gap, 10.0, 0.0)})
    pcb = tmp_path / "syn.kicad_pcb"
    write_board(c, pl, pcb, layers=2)
    out = tmp_path / "drc.json"
    r = subprocess.run([KICAD_CLI, "pcb", "drc", "--format", "json", "--severity-all", "-o", str(out), str(pcb)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return [v for v in json.loads(out.read_text())["violations"] if v["type"] == "clearance"]


def test_drc_enforces_mains_to_low_voltage_clearance(tmp_path):
    v = _synthetic_drc(tmp_path, 5.0)
    assert v, "a MAINS_ pad 5 mm from a non-mains pad must violate the 8 mm rule"
    assert any("mains to low voltage" in x["description"] for x in v), [x["description"] for x in v]
    assert any("8.0000 mm" in x["description"] for x in v)


def test_drc_accepts_mains_to_low_voltage_beyond_the_rule(tmp_path):
    assert _synthetic_drc(tmp_path, 12.0) == []


def test_drc_enforces_mains_to_mains_clearance(tmp_path):
    v = _synthetic_drc(tmp_path, 2.0, second_mains=True)
    assert any("mains to mains" in x["description"] for x in v), [x["description"] for x in v]


def test_drc_accepts_mains_to_mains_beyond_the_rule(tmp_path):
    assert _synthetic_drc(tmp_path, 4.0, second_mains=True) == []


# ---------------------------------------------------------------- PCBWay BOM

def test_pcbway_bom_has_every_assembled_part(tmp_path):
    write_bom_pcbway(C, tmp_path / "bom.csv")
    rows = list(csv.DictReader(open(tmp_path / "bom.csv")))
    assert list(rows[0]) == ["Item #", "Designator", "Qty", "Manufacturer", "Mfg Part #", "Description / Value",
                             "Package/Footprint", "Type", "Your Instructions / Notes"]
    refs = [r for row in rows for r in row["Designator"].split(",")]
    assert sorted(refs) == sorted(set(C.instances) - {"TP1", "H1", "H2", "H3", "H4"})
    assert len(refs) == len(set(refs))
    for row in rows:
        assert int(row["Qty"]) == len(row["Designator"].split(",")), row
        assert row["Manufacturer"] and row["Mfg Part #"], row
        assert re.fullmatch(r"LCSC C\d+", row["Your Instructions / Notes"]), row
        assert row["Type"] in ("THT", "SMD")
    assert [int(r["Item #"]) for r in rows] == list(range(1, len(rows) + 1))


def test_pcbway_bom_marks_through_hole_parts(tmp_path):
    write_bom_pcbway(C, tmp_path / "bom.csv")
    rows = list(csv.DictReader(open(tmp_path / "bom.csv")))
    tht = {r for row in rows if row["Type"] == "THT" for r in row["Designator"].split(",")}
    assert tht == {"K1", "J2", "SW2"}
    qty = {r["Mfg Part #"]: int(r["Qty"]) for r in rows}
    for key in ("R10K", "C100N", "C10U", "R100", "R100K"):
        want = sum(1 for i in C.instances.values() if i.part.key == key)
        assert want > 0 and qty[hb_mpn(key)] == want, key


def hb_mpn(key):
    from board.parts import MFR
    return MFR[key][1]
