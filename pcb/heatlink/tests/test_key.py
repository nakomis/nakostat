"""The board key (board/key.py): every part has an entry, and the diagram and KEY.md are built
from the placement."""
from PIL import Image

from board import heatlink_board as hb
from board import key

C = hb.build_heatlink()


def test_every_part_has_a_key_entry():
    assert set(key.KEY) == set(C.instances)


def test_entries_are_complete():
    for ref, (group, part, what, why) in key.KEY.items():
        assert group in key.GROUPS, ref
        assert part and what and why, ref
        assert "|" not in part + what + why, ref        # would break the markdown table


def test_vent_marks_the_regulator():
    assert C.instances[key.VENT].part.value.startswith("AP2112")


def test_board_frame_from_alpha():
    img = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
    img.paste((0, 0, 0, 255), (50, 40, 50 + 132, 40 + 98))     # a 66 x 49 board at 2 px/mm
    assert key.board_frame(img) == (50, 40, 2.0)


def test_key_png_and_md(tmp_path):
    top = tmp_path / "top.png"
    img = Image.new("RGBA", (800, 600), (0, 0, 0, 0))
    img.paste((20, 20, 20, 255), (100, 100, 100 + 396, 100 + 294))   # 6 px/mm
    img.save(top)
    out = key.key_png(top, tmp_path / "key.png")
    assert Image.open(out).mode == "RGB"
    md = key.key_md("out/key.png")
    assert "![" in md and "(out/key.png)" in md
    for i, ref in enumerate(key.KEY, 1):
        assert f"| {i} | {ref} |" in md
    for _, heading, _ in key.GROUPS.values():
        assert f"## {heading}" in md
