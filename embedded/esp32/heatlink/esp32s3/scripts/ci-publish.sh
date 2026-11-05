#!/usr/bin/env bash
# Sign an unsigned heatlink image with one environment's key and publish it for Fleet, from CI.
# STAT-81, adapted from tinycrypt's embedded/esp32s3/tools/ci-publish.sh.
#
#   embedded/esp32/heatlink/esp32s3/scripts/ci-publish.sh <sandbox|prod> <unsigned.bin> <x.y.z>
#
# A merge's build goes to sandbox signed with sandbox's key, then the same unsigned bytes to prod
# signed with prod's (the two signed images differ only in the signature block). Uploads
# s3://nakomis-firmware-{env}/nakostat/<x.y.z>/firmware.bin with signed=true, its sha256 and the
# unsigned image's sha256 as metadata.
#
# The signing key comes from SSM (/nakostat/{env}/ota/signing-key) through the job's OIDC role, into
# a private temporary file, never onto a command line or into the log. The signed image is checked
# against the committed public key (ota-signing/{env}.pub.pem) before it's uploaded. A version already
# published from the same unsigned bytes is fine (a re-run; RSA-PSS signatures are salted, so the
# signed bytes differ each time, hence the unsigned-sha256 metadata); from other bytes it's refused: a
# published version is never replaced.
#
# Needs AWS credentials (the CI role), espsecure.py (esptool) and the AWS CLI.
set -euo pipefail
umask 077

usage="usage: ci-publish.sh <sandbox|prod> <unsigned.bin> <x.y.z>"
env=${1:?$usage}
unsigned=${2:?$usage}
version=${3:?$usage}
case "$env" in sandbox | prod) ;; *) echo "env must be sandbox or prod" >&2; exit 2 ;; esac
[[ "$version" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || { echo "version must be x.y.z" >&2; exit 2; }
[ -s "$unsigned" ] || { echo "$unsigned is missing or empty" >&2; exit 1; }
here=$(cd "$(dirname "$0")/.." && pwd)
pub="$here/ota-signing/${env}.pub.pem"
[ -s "$pub" ] || { echo "no public key for $env ($pub)" >&2; exit 1; }
bucket="nakomis-firmware-${env}"
object="nakostat/${version}/firmware.bin"

# An image that's already signed would get a second block, which the heatlink would never check.
if espsecure.py verify_signature --version 2 --keyfile "$pub" "$unsigned" > /dev/null 2>&1; then
    echo "$unsigned is already signed: publish the unsigned build" >&2
    exit 1
fi

dir=$(mktemp -d)
trap 'rm -f "$dir"/*; rmdir "$dir"' EXIT
aws ssm get-parameter --name "/nakostat/${env}/ota/signing-key" --with-decryption \
    --query Parameter.Value --output text > "$dir/key.pem"
espsecure.py sign_data --version 2 --keyfile "$dir/key.pem" --output "$dir/signed.bin" "$unsigned" > /dev/null
rm -f "$dir/key.pem"
espsecure.py verify_signature --version 2 --keyfile "$pub" "$dir/signed.bin" > /dev/null 2>&1 || {
    echo "the image isn't signed by the $env key (ota-signing/${env}.pub.pem): not publishing" >&2
    exit 1
}
sha=$(sha256sum "$dir/signed.bin" | cut -d' ' -f1)
unsigned_sha=$(sha256sum "$unsigned" | cut -d' ' -f1)

if existing=$(aws s3api head-object --bucket "$bucket" --key "$object" --query 'Metadata."unsigned-sha256"' --output text 2> /dev/null); then
    if [ "$existing" = "$unsigned_sha" ]; then
        echo "nakostat ${version} is already published to ${env} with these bytes"
        exit 0
    fi
    echo "s3://${bucket}/${object} already exists with other bytes: a published version is never replaced" >&2
    exit 1
fi
# --if-none-match: never replaced, even by a publish racing this one.
aws s3api put-object --bucket "$bucket" --key "$object" --body "$dir/signed.bin" --if-none-match '*' \
    --content-type application/octet-stream --metadata "signed=true,sha256=${sha},unsigned-sha256=${unsigned_sha}" > /dev/null
echo "published nakostat ${version} (signed, sha256 ${sha}) to s3://${bucket}/${object}"
