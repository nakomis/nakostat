#!/usr/bin/env bash
# Fetch footprints + symbols for every LCSC part into footprints/lcsc.*
set -euo pipefail
cd "$(dirname "$0")"
PARTS=(
  C2913206  # ESP32 (ESP32-S3-MINI-1-N8)
  C265419   # JST5 (SM05B-SRSS-G-TB)
  C7519     # ESD (USBLC6-2SC6)
  C51118    # LDO (AP2112K-3.3TRG1)
  C163512   # PTC (1206L050YR)
  C151296   # TVS (SMF5.0A)
  C318884   # SW (TS-1187A-B-A-B)
  C52917434 # LED (WS2812B-2020-V6)
  C5274168  # RELAY (HF46F/5-HS1)
  C20917    # FET (AO3400A)
  C81598    # DIODE (1N4148W)
  C474952   # TERM (KF128-5.08-2P-AA)
  C1788493  # TOGGLE (MT-0-103-A101-M200-RS, ON-OFF-ON)
  C5184954  # IO (DB125-3.5-8P-GN-S, 8-way 3.5 mm screw terminal)
  C2977594  # IDC (DC3-2.54-16PAS, 16-way boxed header)
  C25905    # R5K1
  C25744    # R10K
  C25900    # R4K7 (I2C pull-ups on the IO terminal)
  C25104    # R330 (LED data series resistor)
  C25076    # R100 (relay FET gate)
  C25741    # R100K (relay FET gate pull-down)
  C1525     # C100N
  C52923    # C1U
  C19702    # C10U
)
# easyeda.com's CloudFront returns 403 for easyeda2kicad's default User-Agent, so run it
# through a one-line wrapper that sends a neutral UA instead.
FAILED=()
for c in "${PARTS[@]}"; do
  # resumable: skip parts whose symbol is already in the library
  grep -q "\"$c\"" footprints/lcsc.kicad_sym 2>/dev/null && continue
  sleep 20   # be polite: easyeda.com rate-limits bursts with a 403
  .venv/bin/python -c '
import sys
from easyeda2kicad.easyeda.easyeda_api import EasyedaApi
_init = EasyedaApi.__init__
def init(self):
    _init(self)
    self.headers["User-Agent"] = "heatlink-board-fetch"
EasyedaApi.__init__ = init
from easyeda2kicad.__main__ import main
sys.argv[0] = "easyeda2kicad"
sys.exit(main())
' --symbol --footprint --lcsc_id="$c" --output footprints/lcsc --overwrite || FAILED+=("$c")
done
if ((${#FAILED[@]})); then echo "FAILED: ${FAILED[*]}" >&2; exit 1; fi
