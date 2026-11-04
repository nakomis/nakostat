#!/usr/bin/env python3
"""Board generator: circuit -> placement -> (route) -> board + DRC -> fab outputs.

    ./.venv/bin/python build.py [--route] [--step] [--passes N]

Output goes to out/heatlink/, plus KEY.md here. Fab outputs (gerbers zip, BOMs, CPL, renders, the
labelled key diagram, pins.h) are written
only when DRC has no errors and no unconnected items. DRC includes the mains spacing rules in
the board's .kicad_dru (board/kicad_pcb.py)."""
import argparse
import json
import subprocess
from pathlib import Path

from board import heatlink_board as hb
from board.cleanup import prune
from board.fab import export_step, fab, write_bom, write_bom_pcbway, write_cpl
from board.key import write_key
from board.kicad_pcb import write_board
from board.netlist import check
from board.route import route

HERE = Path(__file__).resolve().parent
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"

# Gerbers carry no colour; this only makes the KiCad renders match the order.
MASK, SILK = "Black", "White"
LAYERS = 2
STEM = "nakostat-heatlink"
LOG = "/tmp/claude-501/heatlink-board-route.log"


def drc(board, out):
    """Run DRC (refilling zones and saving them into the board); return (errors, warnings)."""
    subprocess.run([KICAD_CLI, "pcb", "drc", "--refill-zones", "--save-board", "--format", "json",
                    "--severity-all", "-o", str(out / "drc.json"), str(board)], check=True,
                   capture_output=True)
    d = json.loads((out / "drc.json").read_text())
    bad = [f"unconnected: {' / '.join(i['description'] for i in u['items'])}" for u in d["unconnected_items"]]
    bad += [f"{v['type']}: {v['description']} "
            f"[{'; '.join(i['description'] for i in v.get('items', []))}]"
            for v in d["violations"] if v["severity"] == "error"]
    warn = [v for v in d["violations"] if v["severity"] != "error"]
    return bad, warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--route", action="store_true")
    ap.add_argument("--passes", type=int, default=100)
    ap.add_argument("--step", action="store_true",
                    help="also fetch the 3D models and write the STEP model and a 3D render")
    a = ap.parse_args()
    out = HERE / "out" / "heatlink"
    tmp = out / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    c = hb.build_heatlink()
    problems = check(c)
    if problems:
        raise SystemExit("\n".join(problems))
    p = hb.place_heatlink(c)
    hand_tracks, fixed = hb.mains_hand_route()
    # A GND via beside every SMD GND pad, placed before routing so that the router leaves room
    # for it: each pad then reaches the B.Cu pour however the tracks wall it in on F.Cu.
    drop_t, drop_v = hb.gnd_drops(c, p, hand_tracks, fixed)
    print(f"GND drops: {len(drop_v)}; no room beside: {hb.MISSED or 'none'}")
    hand_tracks, fixed = hand_tracks + drop_t, fixed + drop_v
    tracks, vias = list(hand_tracks), list(fixed)
    if a.route:
        mains = tuple(n for n in c.nets if n.startswith("MAINS_"))
        # The drops go to the router as fixed wiring, which it routes around. GND itself is left
        # to the pours, so Freerouting reports it "unrouted" and skips its optimisation pass;
        # keeping the drops out of its way with keepouts instead cost it whole nets.
        routed_tracks, routed = route(c, p, tmp, passes=a.passes, layers=LAYERS, route_area=hb.route_area(),
                                      fixed_vias=fixed, fixed_tracks=drop_t, layer_keepouts=hb.layer_keepouts(),
                                      via_keepouts=hb.back_text_boxes(),
                                      skip_nets=("GND",) + mains, log=LOG)
        tracks, vias = prune(c, p, tracks + routed_tracks, fixed + routed, keep=fixed)
        stitch = hb.stitch_vias(c, p, tracks, vias)
        print(f"stitching: {len(stitch)} GND vias")
        vias += stitch
    board = out / f"{STEM}.kicad_pcb"
    notes, rects = hb.fab_notes()
    write_board(c, p, board, tracks, vias, layers=LAYERS, silk=hb.silk(c, p) + notes, art=hb.art_heatlink(),
                hide_refs=set(c.instances), mask=MASK, silkscreen=SILK,
                keepouts=hb.keepouts(), pad_extra=hb.pad_extra(c), user_rects=rects + hb.boundary())
    bad, warn = drc(board, out)
    kinds = {}
    for v in warn:
        kinds[v["type"]] = kinds.get(v["type"], 0) + 1
    print(f"wrote {board}: {len(bad)} DRC errors/unconnected, {len(warn)} warnings {kinds}")
    if bad:      # kicad-cli exits 0 even when DRC fails
        raise SystemExit("DRC failed:\n" + "\n".join(bad))
    write_bom(c, out / "bom-jlcpcb.csv")
    write_bom_pcbway(c, out / "bom-pcbway.csv")
    write_cpl(c, p, out / "cpl.csv")
    (out / "pins.h").write_text(hb.pins_h())
    fab(board, out, layers=LAYERS)
    write_key(out, STEM, HERE)
    if a.step:
        subprocess.run([str(HERE / "fetch_models.sh")], check=True)     # resumable, skips fetched parts
        print(f"STEP: {export_step(board, out)}")
    print(f"fab outputs in {out}: bom-jlcpcb.csv, bom-pcbway.csv, cpl.csv, pins.h, {STEM}-gerbers.zip, "
          f"renders; order with solder mask {MASK}, silkscreen {SILK}")


if __name__ == "__main__":
    main()
