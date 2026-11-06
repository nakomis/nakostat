import json
import subprocess
from pathlib import Path

from board import heatlink_board as hb
from board.dsn import write_dsn
from board.ses import read_ses

DATA = Path(__file__).parent / "data"
ROOT = Path(__file__).resolve().parent.parent


def test_read_ses_converts_units_and_flips_y():
    tracks, vias = read_ses(DATA / "mini.ses")
    assert len(tracks) == 2 and len(vias) == 1
    t = tracks[0]
    assert (t.net, t.layer, t.width) == ("GND", "F.Cu", 0.15)
    assert (t.x1, t.y1, t.x2, t.y2) == (100.0, 100.0, 110.0, 100.0)
    assert (vias[0].x, vias[0].y) == (110.0, 105.0)


def _dsn(tmp_path):
    """Write the DSN exactly as build.py --route hands it to the router."""
    c = hb.build_heatlink()
    p = hb.place_heatlink(c)
    hand_t, hand_v = hb.mains_hand_route()
    drop_t, drop_v = hb.gnd_drops(c, p, hand_t, hand_v)
    mains = tuple(n for n in c.nets if n.startswith("MAINS_"))
    write_dsn(c, p, tmp_path / "a.dsn", layers=2, route_area=hb.route_area(),
              fixed_vias=hand_v + drop_v, fixed_tracks=drop_t, layer_keepouts=hb.layer_keepouts(),
              via_keepouts=hb.back_text_boxes(),
              skip_nets=("GND",) + mains)
    return c, drop_t, hand_v + drop_v, (tmp_path / "a.dsn").read_text()


def test_dsn_two_layer(tmp_path):
    c, _, _, text = _dsn(tmp_path)
    assert "(plane" not in text and "In1.Cu" not in text
    assert "(layer F.Cu (type signal))" in text and "(layer B.Cu (type signal))" in text
    assert text.count("(net ") >= len(c.nets)
    assert "(class gnd GND" not in text and '(class power "+3V3" VBUS' in text
    gnd = next(l for l in text.splitlines() if l.strip().startswith("(net GND"))
    assert gnd.count("-") == 1                    # GND is left to the pours: one pin, nothing to route


def test_dsn_leaves_mains_nets_to_the_hand_route(tmp_path):
    """The mains nets are declared but carry one pin only, so the router does not route them."""
    _, _, _, text = _dsn(tmp_path)
    for net in ("MAINS_L", "MAINS_SL"):
        line = next(l for l in text.splitlines() if l.strip().startswith(f"(net {net}"))
        assert line.count("-") == 1, line
        assert f"(class default" in text and net not in next(
            l for l in text.splitlines() if l.strip().startswith("(class default"))


def test_dsn_boundary_is_the_low_voltage_route_area(tmp_path):
    _, _, _, text = _dsn(tmp_path)
    line = next(l for l in text.splitlines() if "(boundary" in l)
    nums = [int(v) for v in line.replace(")", " ").split()[4:]]
    xs = [x / 1000 for x in nums[0::2]]
    ys = [-y / 1000 for y in nums[1::2]]
    assert abs(min(xs) - hb.MAINS_X) < 1e-6 and abs(max(xs) - (hb.L - hb.EDGE_INSET)) < 1e-6
    assert abs(min(ys) - hb.EDGE_INSET) < 1e-6 and abs(max(ys) - (hb.W - hb.EDGE_INSET)) < 1e-6


def test_dsn_repeated_pad_numbers_get_unique_pin_ids(tmp_path):
    c = hb.build_heatlink()
    write_dsn(c, hb.place_heatlink(c), tmp_path / "b.dsn", layers=2)
    text = (tmp_path / "b.dsn").read_text()
    img = next(l for l in text.splitlines() if "(image U1_img" in l)
    assert img.count(' GND ') == 1 and ' GND_13 ' in img and ' GND_14 ' not in img
    gnd = next(l for l in text.splitlines() if l.strip().startswith("(net GND"))
    assert "U1-GND_13" in gnd and "U1-GND " in gnd and "U1-46" in gnd


def test_dsn_carries_gnd_drops_as_fixed_wiring(tmp_path):
    _, drop_t, fixed_v, text = _dsn(tmp_path)
    assert drop_t and fixed_v
    assert text.count("(type protect)") == len(drop_t)
    assert text.count("(type fix)") == len(fixed_v)
    assert "(keepout" not in text                                  # layer_keepouts() is empty
    assert text.count("(via_keepout") == 2 * len(hb.back_text_boxes())     # both layers, per text line


def test_gnd_drops_found_room_for_every_pad():
    c = hb.build_heatlink()
    p = hb.place_heatlink(c)
    hb.MISSED.clear()
    t, v = hb.mains_hand_route()
    hb.gnd_drops(c, p, t, v)
    assert hb.MISSED == []


def _via_in_box(v, box, r=0.0):
    return box[0] - r < v.x < box[2] + r and box[1] - r < v.y < box[3] + r


def test_gnd_drops_avoid_the_back_text():
    c = hb.build_heatlink()
    p = hb.place_heatlink(c)
    t, v = hb.mains_hand_route()
    _, drop_v = hb.gnd_drops(c, p, t, v)
    assert drop_v
    for via in drop_v:
        assert not hb.under_back_text(via.x, via.y), via
        assert not any(_via_in_box(via, b) for b in hb.back_text_boxes()), via


def test_stitching_vias_avoid_the_portrait_and_the_back_text():
    c = hb.build_heatlink()
    p = hb.place_heatlink(c)
    t, v = hb.mains_hand_route()
    dt, dv = hb.gnd_drops(c, p, t, v)
    stitch = hb.stitch_vias(c, p, t + dt, v + dv)
    assert stitch
    for via in stitch:
        assert not hb.on_art(via.x, via.y), via
        assert not hb.under_back_text(via.x, via.y), via
        assert via.x > hb.MAINS_X


def test_back_text_boxes_hold_the_back_text_and_stay_on_the_board():
    boxes = hb.back_text_boxes()
    assert len(boxes) == len(hb.BACK_TEXT) == 3
    for b in boxes:
        assert 0 <= b[0] < b[2] <= hb.L and 0 <= b[1] < b[3] <= hb.W, b
    c = hb.build_heatlink()
    back = {e[0] for e in hb.silk(c, hb.place_heatlink(c)) if len(e) > 4 and e[4] == "B.SilkS"}
    assert {t for t, _, _ in hb.BACK_TEXT} <= back


def _snapshot(d):
    return {p.relative_to(d): (p.stat().st_mtime_ns, p.stat().st_size) for p in d.rglob("*") if p.is_file()}


def test_full_route_is_drc_clean(tmp_path):
    """Integration: run build.py --route and check its outputs (slow). It builds into tmp_path:
    Freerouting doesn't route the same way twice, so building in place would overwrite the
    ordered board in out/heatlink/ (STAT-79)."""
    ordered = ROOT / "out" / "heatlink"
    ordered_doc = ROOT.parent.parent / "docs" / "heatlink-board-key.md"
    before = _snapshot(ordered), ordered_doc.stat().st_mtime_ns
    out = tmp_path / "heatlink"
    r = subprocess.run(["./.venv/bin/python", "build.py", "--route", "--out", str(out)], cwd=ROOT,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert (_snapshot(ordered), ordered_doc.stat().st_mtime_ns) == before
    assert (out / "heatlink-board-key.md").exists()
    drc = json.loads((out / "drc.json").read_text())
    assert drc["unconnected_items"] == []
    assert [v for v in drc["violations"] if v["severity"] == "error"] == []
    for name in ("nakostat-heatlink.kicad_pcb", "bom-jlcpcb.csv", "bom-pcbway.csv", "cpl.csv", "pins.h",
                 "nakostat-heatlink-gerbers.zip", "nakostat-heatlink-top.png", "nakostat-heatlink-bottom.png"):
        assert (out / name).exists(), name
    assert (out / "nakostat-heatlink.kicad_dru").exists()
    from board.sexpr import find, find_all, parse
    tree = parse((out / "nakostat-heatlink.kicad_pcb").read_text())
    vias = [type("V", (), {"x": find(v, "at")[1], "y": find(v, "at")[2]}) for v in find_all(tree, "via")]
    assert vias
    for v in vias:
        if (v.x, v.y) in {(t.x1, t.y1) for t in hb.mains_hand_route()[0]}:
            continue
        assert not any(_via_in_box(v, b) for b in hb.back_text_boxes()), (v.x, v.y)


def test_read_ses_reports_widened_segments(tmp_path):
    ses = tmp_path / "n.ses"
    ses.write_text('(session n (routes (resolution um 1) (network_out (net A (wire (path F.Cu 100 0 0 1000 0))))))')
    rep = {}
    tracks, _ = read_ses(ses, min_width=0.15, report=rep)
    assert tracks[0].width == 0.15 and rep == {"widened": 1, "widened_mm": 1.0}
