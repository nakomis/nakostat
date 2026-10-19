#!/usr/bin/env bash
# Render the heatlink prototype case: STLs, PNG previews and fit checks.
#
#   ./make.sh                         # defaults
#   ./make.sh -D 'switch_hole_d=6.2'  # any OpenSCAD -D overrides pass through
#
# Fails on any OpenSCAD warning or error, on a non-manifold result, if the
# base and lid interfere when closed, or if the lid ribs miss the barrier.
set -euo pipefail

cd "$(dirname "$0")"

OPENSCAD="${OPENSCAD:-}"
if [[ -z "$OPENSCAD" ]]; then
    if [[ -x /Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD ]]; then
        OPENSCAD=/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD
    else
        OPENSCAD=openscad
    fi
fi

SRC=heatlink-case.scad
OUT=out
mkdir -p "$OUT"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

fail() { echo "FAIL: $*" >&2; cat "$LOG" >&2; exit 1; }

# run <output> <part> [extra openscad args...]
run() {
    local out="$1" part="$2"; shift 2
    if ! "$OPENSCAD" -o "$out" -D "part=\"$part\"" "$@" "$SRC" >"$LOG" 2>&1; then
        fail "openscad exited non-zero rendering $part -> $out"
    fi
    if grep -Eq 'WARNING|ERROR' "$LOG"; then
        fail "warnings/errors rendering $part -> $out"
    fi
}

# A rendered solid must be manifold: "Status: NoError" (Manifold backend)
# or "Simple: yes" (CGAL backend).
check_solid() {
    grep -Eq 'Status:[[:space:]]+NoError|Simple:[[:space:]]+yes' "$LOG" || fail "$1 is not a clean manifold"
}

# PNG[0] is --render; the assembly preview drops it (translucent lid renders better in preview)
PNG=(--render --imgsize=1200,900 --viewall --autocenter --colorscheme=Tomorrow)

for part in base lid; do
    echo "== $part"
    run "$OUT/heatlink-case-$part.stl" "$part" "$@" --export-format binstl
    check_solid "$part"
    grep -E 'HEATLINK outer' "$LOG" | sed 's/^ECHO: //' || true
done

# An intersection that should be empty makes OpenSCAD exit non-zero
# ("Current top level object is empty"), so these don't go through run().
CHK="$(mktemp -d)"
trap 'rm -rf "$LOG" "$CHK"' EXIT

echo "== fit check (base vs lid, closed): must be empty"
"$OPENSCAD" -o "$CHK/check.stl" -D 'part="check"' "$@" "$SRC" >"$LOG" 2>&1 || true
grep -Eq 'WARNING|ERROR' "$LOG" && fail "warnings/errors in the fit check"
grep -q 'Current top level object is empty' "$LOG" || fail "base and lid interfere when closed"

echo "== rib overlap (lid ribs vs barrier): must be non-empty"
run "$CHK/rib.stl" rib_overlap "$@"
grep -q 'Current top level object is empty' "$LOG" && fail "lid ribs do not reach over the barrier"

# CI sets NO_PREVIEWS: PNG export needs an OpenGL context the runner doesn't have.
if [[ -n "${NO_PREVIEWS:-}" ]]; then
    echo "OK (no previews): $(ls "$OUT")"
    exit 0
fi

echo "== previews"
run "$OUT/heatlink-case-base.png"     base     "$@" "${PNG[@]}" --camera=0,0,0,55,0,25,0
run "$OUT/heatlink-case-base-top.png" base     "$@" "${PNG[@]}" --projection=o --camera=0,0,0,0,0,0,0
run "$OUT/heatlink-case-lid.png"      lid      "$@" "${PNG[@]}" --projection=o --camera=0,0,0,180,0,0,0
run "$OUT/heatlink-case-assembly.png" assembly "$@" "${PNG[@]:1}" --camera=0,0,0,55,0,25,0
run "$OUT/heatlink-case-section.png"  section  "$@" "${PNG[@]}" --projection=o --camera=0,0,0,90,0,90,0

echo "OK: $(ls "$OUT")"
