"""Host test fixtures: the drivers in heatlink/tools/ are built once per session and run as processes."""

import json
import os
import subprocess
from pathlib import Path
from typing import Callable

import pytest

HEATLINK = Path(__file__).resolve().parent.parent
BUILD = Path(os.environ.get("HL_BUILD", HEATLINK / "build"))


@pytest.fixture(scope="session", autouse=True)
def built():
    """Configure and build the host drivers (a no-op when they are up to date)."""
    for cmd in (["cmake", "-S", str(HEATLINK), "-B", str(BUILD)], ["cmake", "--build", str(BUILD)]):
        done = subprocess.run(cmd, capture_output=True, text=True)
        if done.returncode != 0:
            pytest.exit(f"{' '.join(cmd)} failed:\n{done.stdout}\n{done.stderr}", returncode=1)


@pytest.fixture
def tool() -> Callable[..., Callable[[str], str]]:
    """tool(name, *args) -> run(stdin) -> stdout, for the driver heatlink/build/<name>."""

    def get(name: str, *args: str, env: dict | None = None) -> Callable[[str], str]:
        exe = BUILD / name

        def run(stdin: str = "") -> str:
            return subprocess.run([str(exe), *args], input=stdin, capture_output=True, text=True,
                                  check=True, env=env).stdout

        return run

    return get


@pytest.fixture
def json_tool(tool):
    """json_tool(name) -> run(*objects) -> one parsed JSON answer per object sent (a str goes as it is)."""

    def get(name: str):
        run = tool(name)

        def go(*objects):
            lines = "".join((o if isinstance(o, str) else json.dumps(o)) + "\n" for o in objects)
            return [json.loads(line) for line in run(lines).splitlines()]

        return go

    return get


def schedule(days=None, **extra):
    """A set_schedule command: days defaults to seven empty days."""
    cmd = {"command": "set_schedule", "days": days if days is not None else [[] for _ in range(7)]}
    cmd.update(extra)
    return cmd


def every_day(entries):
    return [list(entries) for _ in range(7)]
