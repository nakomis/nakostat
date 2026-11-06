"""The board table (port/board.c), through hl-board, and its agreement with the PCB's generated pins.h."""

import re
import subprocess

import pytest

from conftest import HEATLINK

PINS_H = HEATLINK.parent.parent.parent / "pcb" / "heatlink" / "out" / "heatlink" / "pins.h"
PROVISION = HEATLINK / "scripts" / "provision-device.sh"


def board(tool, *args):
    return tool("hl-board", *args)("").strip()


def test_devkitc_is_the_prototype_map(tool):
    assert board(tool, "devkitc") == "devkitc 4 active_low 5 6 48"
    assert board(tool, "devkitc-v1.1") == "devkitc-v1.1 4 active_low 5 6 38"


@pytest.mark.parametrize("args", [(), ("",)])
def test_no_board_is_the_devkitc(tool, args):
    # A heatlink provisioned before the board key existed.
    assert board(tool, *args).split()[0] == "devkitc"


@pytest.mark.parametrize("name", ["pcb", "PCB-V1", "pcb-v2", " devkitc"])
def test_unknown_board(tool, name):
    assert board(tool, name) == "unknown"


def test_all_lists_every_board_once(tool):
    names = [line.split()[0] for line in board(tool, "--all").splitlines()]
    assert names == ["devkitc", "devkitc-v1.1", "pcb-v1"]


def test_every_name_fits_the_boot_buffer(tool):
    # main.c reads the board key into 16 bytes; a longer name would read as no board.
    for line in board(tool, "--all").splitlines():
        assert len(line.split()[0]) < 16


def test_pcb_v1_matches_the_generated_pins_h(tool):
    text = PINS_H.read_text()
    pins = {k: int(v) for k, v in re.findall(r"#define HL_PIN_(\w+) (\d+)", text)}
    name, relay, polarity, sw_on, sw_off, led = board(tool, "pcb-v1").split()
    assert (int(relay), int(sw_on), int(sw_off), int(led)) == (
        pins["RELAY"], pins["SW_ON"], pins["SW_OFF"], pins["LED"])
    assert "The relay is active-high" in text and polarity == "active_high"
    assert "the switch throws are active-low" in text


def test_no_two_signals_share_a_pin(tool):
    for line in board(tool, "--all").splitlines():
        _, relay, _, sw_on, sw_off, led = line.split()
        assert len({relay, sw_on, sw_off, led}) == 4, line


def test_provisioning_offers_exactly_the_known_boards(tool):
    listed = re.search(r'^BOARDS="([^"]*)"$', PROVISION.read_text(), re.M).group(1).split()
    assert listed == [line.split()[0] for line in board(tool, "--all").splitlines()]


@pytest.mark.parametrize("args,error", [((), "--board is required"), (("--board", "pcb"), "unknown board 'pcb'"),
                                        (("--board",), "--board needs a value")])
def test_provisioning_refuses_a_missing_or_unknown_board(args, error):
    # Argument checks come before any AWS call.
    done = subprocess.run(["bash", str(PROVISION), *args], capture_output=True, text=True)
    assert done.returncode == 2 and error in done.stderr
