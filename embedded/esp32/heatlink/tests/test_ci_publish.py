"""esp32s3/scripts/ci-publish.sh (STAT-81): signs with the environment's key from SSM, checks the
signature against the committed public key, and publishes once. Run against throwaway keys and a fake
`aws` that keeps SSM and the bucket in a directory."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import HEATLINK

SCRIPT = HEATLINK / "esp32s3" / "scripts" / "ci-publish.sh"
BIN = Path(sys.executable).parent  # espsecure.py, from esptool in tests/requirements.txt

FAKE_AWS = r"""#!/usr/bin/env bash
# The calls ci-publish.sh makes, against $FAKE: ssm/<param> holds parameters, s3/<key> objects and
# s3/<key>.meta their metadata ("k=v,k=v").
set -euo pipefail
case "$1 $2" in
"ssm get-parameter")
    name=${4:?}
    [ -f "$FAKE/ssm/$name" ] || { echo "ParameterNotFound" >&2; exit 254; }
    cat "$FAKE/ssm/$name" ;;
"s3api head-object")
    key=${6:?}
    [ -f "$FAKE/s3/$key" ] || { echo "Not Found" >&2; exit 254; }
    tr ',' '\n' < "$FAKE/s3/$key.meta" | sed -n 's/^unsigned-sha256=//p' ;;
"s3api put-object")
    shift 2
    while [ $# -gt 0 ]; do
        case "$1" in
        --key) key=$2; shift ;;
        --body) body=$2; shift ;;
        --metadata) meta=$2; shift ;;
        esac
        shift
    done
    mkdir -p "$(dirname "$FAKE/s3/$key")"
    cp "$body" "$FAKE/s3/$key"
    printf '%s' "$meta" > "$FAKE/s3/$key.meta" ;;
*) echo "fake aws: unexpected $*" >&2; exit 1 ;;
esac
"""


def espsecure(*args):
    return subprocess.run([str(BIN / "espsecure.py"), *args], capture_output=True, text=True)


@pytest.fixture(scope="session")
def keys(tmp_path_factory):
    """Two RSA-3072 keys, the second standing in for a wrong one."""
    d = tmp_path_factory.mktemp("keys")
    for name in ("right", "wrong"):
        assert espsecure("generate_signing_key", "--version", "2", "--scheme", "rsa3072",
                         str(d / f"{name}.pem")).returncode == 0
        assert espsecure("extract_public_key", "--version", "2", "--keyfile", str(d / f"{name}.pem"),
                         str(d / f"{name}.pub.pem")).returncode == 0
    return d


@pytest.fixture
def world(tmp_path, keys):
    """The script in a copy of its tree (with the right key's public half committed for sandbox), SSM
    holding `ssm_key`, an empty bucket, and an unsigned image."""
    tree = tmp_path / "esp32s3"
    (tree / "scripts").mkdir(parents=True)
    shutil.copy(SCRIPT, tree / "scripts")
    (tree / "ota-signing").mkdir()
    shutil.copy(keys / "right.pub.pem", tree / "ota-signing" / "sandbox.pub.pem")
    fake = tmp_path / "fake"
    (fake / "ssm" / "nakostat" / "sandbox" / "ota").mkdir(parents=True)
    (fake / "s3").mkdir()
    (fake / "bin").mkdir()
    (fake / "bin" / "aws").write_text(FAKE_AWS)
    (fake / "bin" / "aws").chmod(0o755)
    image = tmp_path / "nakostat.bin"
    image.write_bytes(os.urandom(8192))

    class World:
        def set_key(self, name):
            shutil.copy(keys / f"{name}.pem", fake / "ssm" / "nakostat" / "sandbox" / "ota" / "signing-key")

        def publish(self, *args):
            env = {**os.environ, "FAKE": str(fake), "PATH": f"{fake / 'bin'}:{BIN}:{os.environ['PATH']}"}
            return subprocess.run(["bash", str(tree / "scripts" / "ci-publish.sh"), *args],
                                  capture_output=True, text=True, env=env)

        def published(self, version="1.2.3"):
            return fake / "s3" / "nakostat" / version / "firmware.bin"

    w = World()
    w.image, w.keys, w.tree = image, keys, tree
    w.set_key("right")
    return w


def test_signs_with_the_environment_key_and_publishes(world):
    done = world.publish("sandbox", str(world.image), "1.2.3")
    assert done.returncode == 0, done.stderr
    out = world.published()
    assert espsecure("verify_signature", "--version", "2", "--keyfile", str(world.keys / "right.pub.pem"),
                     str(out)).returncode == 0
    meta = dict(kv.split("=", 1) for kv in Path(f"{out}.meta").read_text().split(","))
    assert meta["signed"] == "true"
    assert meta["unsigned-sha256"] == subprocess.run(["sha256sum", str(world.image)], capture_output=True,
                                                     text=True).stdout.split()[0]
    # The signed image is the unsigned one plus its signature sector.
    assert out.read_bytes().startswith(world.image.read_bytes())


def test_never_publishes_a_wrong_key_signature(world):
    world.set_key("wrong")
    done = world.publish("sandbox", str(world.image), "1.2.3")
    assert done.returncode == 1 and "isn't signed by the sandbox key" in done.stderr
    assert not world.published().exists()


def test_refuses_an_image_that_is_already_signed(world, tmp_path):
    signed = tmp_path / "signed.bin"
    assert espsecure("sign_data", "--version", "2", "--keyfile", str(world.keys / "right.pem"),
                     "--output", str(signed), str(world.image)).returncode == 0
    done = world.publish("sandbox", str(signed), "1.2.3")
    assert done.returncode == 1 and "already signed" in done.stderr
    assert not world.published().exists()


def test_refuses_an_image_signed_with_another_environments_key(world, tmp_path):
    # As if signed for prod: its public half is committed too, so ci-publish.sh for sandbox knows it.
    shutil.copy(world.keys / "wrong.pub.pem", world.tree / "ota-signing" / "prod.pub.pem")
    signed = tmp_path / "signed.bin"
    assert espsecure("sign_data", "--version", "2", "--keyfile", str(world.keys / "wrong.pem"),
                     "--output", str(signed), str(world.image)).returncode == 0
    done = world.publish("sandbox", str(signed), "1.2.3")
    assert done.returncode == 1 and "already signed (prod key)" in done.stderr
    assert not world.published().exists()


def test_a_rerun_with_the_same_bytes_is_fine(world):
    assert world.publish("sandbox", str(world.image), "1.2.3").returncode == 0
    first = world.published().read_bytes()
    done = world.publish("sandbox", str(world.image), "1.2.3")
    assert done.returncode == 0 and "already published" in done.stdout
    assert world.published().read_bytes() == first


def test_a_published_version_is_never_replaced(world):
    assert world.publish("sandbox", str(world.image), "1.2.3").returncode == 0
    world.image.write_bytes(os.urandom(8192))
    done = world.publish("sandbox", str(world.image), "1.2.3")
    assert done.returncode == 1 and "never replaced" in done.stderr


@pytest.mark.parametrize("args,error", [
    (("staging", "x.bin", "1.2.3"), "env must be sandbox or prod"),
    (("sandbox", "x.bin", "1.2"), "version must be x.y.z"),
])
def test_bad_arguments(world, args, error):
    done = world.publish(*args)
    assert done.returncode == 2 and error in done.stderr


def test_an_environment_with_no_public_key_is_refused(world):
    # Prod's public half isn't in this tree.
    done = world.publish("prod", str(world.image), "1.2.3")
    assert done.returncode == 1 and "no public key for prod" in done.stderr
