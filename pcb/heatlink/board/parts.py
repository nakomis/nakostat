"""Parts catalogue: LCSC/EasyEDA footprints and symbols (plus two local board-only footprints),
keyed by role."""
from dataclasses import dataclass
from pathlib import Path

from board.kicadlib import Footprint, load_footprint, load_symbol_pin_types, load_symbol_pins

HERE = Path(__file__).resolve().parent.parent
LCSC_FP = HERE / "footprints" / "lcsc.pretty"
LCSC_SYM = HERE / "footprints" / "lcsc.kicad_sym"
LOCAL_FP = HERE / "footprints" / "local.pretty"


@dataclass
class PartDef:
    key: str
    value: str
    lcsc: str | None         # None: a board-only footprint (test pads, mounting hole), never in BOM/CPL
    footprint: Footprint
    pins: dict
    pin_types: dict
    extended: bool
    tht: bool
    rotation_offset: float   # degrees added to placement rotation for JLCPCB CPL
    body: tuple              # (xmin, ymin, xmax, ymax): the part's real extent, for placement checks


# key: (value, lcsc, footprint file stem, symbol name, extended, rotation_offset)
# Footprint stems and symbol names are exactly what easyeda2kicad wrote. lcsc None means a local,
# board-only footprint from footprints/local.pretty with pin name = pad number.
_TABLE = {
    "ESP32": ("ESP32-S3-MINI-1-N8", "C2913206", "BULETM-SMD_ESP32-S3-MINI-1-N8", "ESP32-S3-MINI-1-N8", True, 0),
    "JST5": ("SM05B-SRSS-G-TB", "C265419", "CONN-SMD_SM05B-SRSS-G-TB-LF-SN", "SM05B-SRSS-G-TB(LF)(SN)", True, 0),
    "ESD": ("USBLC6-2SC6", "C7519", "SOT-23-6_L2.9-W1.6-P0.95-LS2.8-BL", "USBLC6-2SC6", True, 0),
    "LDO": ("AP2112K-3.3TRG1", "C51118", "SOT-25-5_L2.9-W1.6-P0.95-LS2.8-BL", "AP2112K-3.3TRG1", True, 0),
    "PTC": ("500mA PTC", "C163512", "F1206", "1206L050YR", True, 0),
    "TVS": ("SMF5.0A", "C151296", "SOD-123F_L2.8-W1.8-LS3.7-RD", "SMF5.0A_C151296", True, 0),
    "SW": ("TS-1187A-B-A-B", "C318884", "SW-SMD_4P-L5.1-W5.1-P3.70-LS6.5-TL_H1.5", "TS-1187A-B-A-B", False, 0),
    "LED": ("WS2812B-2020-V6", "C52917434", "LED-SMD_4P-L2.2-W2.0-P1.00_WS2815C-2020-4P", "WS2812B-2020-V6", True, 0),
    "RELAY": ("HF46F/5-HS1", "C5274168", "RELAY-TH_HF46F-XX-HS1XX-XXX", "HF46F_5-HS1_C5274168", True, 0),
    "FET": ("AO3400A", "C20917", "SOT-23-3_L2.9-W1.3-P1.90-LS2.4-BR", "AO3400A", False, 0),
    "DIODE": ("1N4148W", "C81598", "SOD-123F_L2.7-W1.6-LS3.8-RD", "1N4148W_C81598", False, 0),
    "TERM": ("KF128-5.08-2P", "C474952", "CONN-TH_P5.08_KF128-5.08-2P", "KF128-5.08-2P", True, 0),
    "TOGGLE": ("MTS-103 ON-OFF-ON", "C1788493", "SW-TH_MT-0-103-A101-M200-RS", "MT-0-103-A101-M200-RS+PJ", True, 0),
    "IO": ("DB125-3.5-8P-GN-S", "C5184954", "CONN-TH_8P-P3.50_DORABO_DB125-3.5-8P-GN-S", "DB125-3.5-8P-GN-S", True, 0),
    "IDC": ("DC3-2.54-16PAS", "C2977594", "IDC-TH_16P-P2.54_C3406", "DC3-2.54-16PAS", True, 0),
    "R5K1": ("5k1", "C25905", "R0402", "0402WGF5101TCE", False, 0),
    "R10K": ("10k", "C25744", "R0402", "0402WGF1002TCE", False, 0),
    "R4K7": ("4k7", "C25900", "R0402", "0402WGF4701TCE", False, 0),
    "R100K": ("100k", "C25741", "R0402", "0402WGF1003TCE", False, 0),
    "R100": ("100R", "C25076", "R0402", "0402WGF1000TCE", False, 0),
    "R330": ("330R", "C25104", "R0402", "0402WGF3300TCE", False, 0),
    "C100N": ("100nF", "C1525", "C0402", "CL05B104KO5NNNC", False, 0),
    "C1U": ("1uF", "C52923", "C0402", "CL05A105KA5NQNC", False, 0),
    "C10U": ("10uF", "C19702", "C0603", "CL10A106KP8NNNC", False, 0),
    "DEBUG": ("Debug pads", None, "DebugPads_1x5_P2.54", None, False, 0),
    "MH": ("M3 hole", None, "MountingHole_M3_3.2mm_Pad6", None, False, 0),
    "MHN": ("M3 hole, unplated", None, "MountingHole_M3_3.2mm_NPTH", None, False, 0),
}

# Manufacturer and part number for each assembled part, for PCBWay's BOM (JLCPCB's takes the LCSC
# number alone). PCBWay buys parts anywhere, so the LCSC number goes in the notes as a source.
MFR = {
    "ESP32": ("Espressif", "ESP32-S3-MINI-1-N8"), "JST5": ("JST", "SM05B-SRSS-G-TB(LF)(SN)"),
    "ESD": ("STMicroelectronics", "USBLC6-2SC6"), "LDO": ("Diodes Inc", "AP2112K-3.3TRG1"),
    "PTC": ("Littelfuse", "1206L050YR"), "TVS": ("Littelfuse", "SMF5.0A"),
    "SW": ("XKB Connection", "TS-1187A-B-A-B"), "LED": ("Worldsemi", "WS2812B-2020-V6"),
    "RELAY": ("Hongfa", "HF46F/5-HS1"), "FET": ("Alpha & Omega", "AO3400A"),
    "DIODE": ("Semtech", "1N4148W"), "TERM": ("Cixi Kefa", "KF128-5.08-2P-AA"),
    "TOGGLE": ("Yuen Fung", "MT-0-103-A101-M200-RS"), "IO": ("DORABO", "DB125-3.5-8P-GN-S"),
    "IDC": ("ZHOURI", "DC3-2.54-16PAS"),
    "R4K7": ("UNI-ROYAL", "0402WGF4701TCE"),
    "R5K1": ("UNI-ROYAL", "0402WGF5101TCE"), "R10K": ("UNI-ROYAL", "0402WGF1002TCE"),
    "R100K": ("UNI-ROYAL", "0402WGF1003TCE"), "R100": ("UNI-ROYAL", "0402WGF1000TCE"),
    "R330": ("UNI-ROYAL", "0402WGF3300TCE"), "C100N": ("Samsung", "CL05B104KO5NNNC"),
    "C1U": ("Samsung", "CL05A105KA5NQNC"), "C10U": ("Samsung", "CL10A106KP8NNNC"),
}

# fetched-name -> our-name, per key. The module symbol calls GPIOn "IOn" and spells the UART0 pins
# TXD0/RXD0 (GPIO43/44), exactly as Espressif's datasheet table does; we keep those names.
ALIASES = {}

# Real extents where the footprint's courtyard is smaller than the part. The EasyEDA module
# footprint's courtyard covers only the pad field (15.4 x 15.4); the module is 15.4 x 20.5 with
# the PCB antenna in the 5.05 mm beyond pads 46-60 (its silkscreen outline: y -12.8 .. 7.7).
# The terminal block, the relay and the toggle switch: their bodies, from the footprints' silk
# outlines and the datasheets (the EasyEDA courtyards are the pad fields).
BODY = {"ESP32": (-7.7, -12.8, 7.7, 7.7),
        "JST5": (-3.9, -2.79, 3.9, 3.16),      # tabs x +-3.9, signal pads to y -2.79, housing front 2.83
        "TERM": (-5.08, -5.4, 5.08, 5.3),
        "RELAY": (-10.4, -3.6, 10.5, 3.6),
        "TOGGLE": (-6.5, -4.0, 6.5, 4.0),
        "IO": (-14.0, -3.9, 14.0, 3.5),         # wire openings on the +y side
        "IDC": (-14.25, -4.52, 14.25, 4.5)}     # the shroud; its key slot is on the +y side
# The antenna strip of the module, in footprint coordinates (above the top pad row).
ESP32_ANTENNA = (-7.7, -12.8, 7.7, -7.75)

# 3D models (fetch_models.sh puts them in footprints/lcsc.3dshapes). Each EasyEDA footprint names its
# model and carries its offset and rotation; parts whose footprint names none get one here.
# WS2812B-2020-V6 (C52917434) has no EasyEDA model: the WS2812B-2020 one (C965555) is the same
# 2.0 x 2.0 x 0.8 mm package, and its footprint has the same pin 1-4 layout as ours to within
# 0.05 mm, with zero model offset and rotation.
LCSC_3D = HERE / "footprints" / "lcsc.3dshapes"
MODEL_OVERRIDE = {"LED": "LED-SMD_4P-L2.0-W2.0-H0.8-TL_WS2812B-2020"}
# Model offsets (x, y, z in mm, KiCad's model frame) that replace easyeda2kicad's where its are
# wrong, found from top and side renders: the SOT-23-6 and C0603 offsets push the bodies off their
# pads, the JST model's origin is 2 mm off its centre, and the capacitor models are centred on
# z = 0 (half inside the board), so they are lifted by half their height. The IDC header's model
# origin is 11.43 mm (4.5 pitches) and 4.57 mm off the footprint's centre.
MODEL_OFFSET = {"ESD": (0, 0, 0), "JST5": (-2.0, -0.33, 0), "IDC": (-11.43, -4.47, 0),
                "C10U": (0, 0, 0.4), "C100N": (0, 0, 0.25), "C1U": (0, 0, 0.25)}


def _load(key, row):
    value, lcsc, fp_stem, sym, extended, rot = row
    fp = load_footprint((LCSC_FP if lcsc else LOCAL_FP) / f"{fp_stem}.kicad_mod")
    pins = {}
    if sym is None:     # footprint-only part: one passive pin per numbered pad, name = number
        pins = {p.number: [p.number] for p in fp.pads if p.number}
        pin_types = {n: "passive" for n in pins}
    else:
        alias = ALIASES.get(key, {})
        for name, nums in load_symbol_pins(LCSC_SYM, sym).items():
            pins.setdefault(alias.get(name, name), []).extend(nums)
        pin_types = load_symbol_pin_types(LCSC_SYM, sym)
    # Through-hole only if most numbered signal pads are drilled.
    numbered = [p for p in fp.pads if p.number]
    tht = bool(numbered) and sum(p.kind == "thru_hole" for p in numbered) * 2 > len(numbered)
    return PartDef(key, value, lcsc, fp, pins, pin_types, extended, tht, rot, BODY.get(key, fp.courtyard))


# Extended parts whose CPL rotation offset has been checked. EasyEDA-fetched footprints follow
# JLCPCB's own orientation convention, so their offset is 0. The final check is a look at
# JLCPCB's placement preview at order time.
ROTATION_CHECKED = {k for k, row in _TABLE.items() if row[4] and row[5] == 0}

PARTS = {k: _load(k, row) for k, row in _TABLE.items()}


def part(key):
    return PARTS[key]
