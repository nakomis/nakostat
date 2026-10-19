#!/usr/bin/env bash
# Publish an unsigned heatlink image for Fleet, from CI.
#
#   embedded/esp32/heatlink/esp32s3/scripts/ci-publish.sh <sandbox|prod> <nakostat.bin> <x.y.z>
#
# A PR's build goes to sandbox; its merge sends the same bytes to prod. Uploads
# s3://nakomis-firmware-{env}/nakostat/<x.y.z>/firmware.bin with its sha256 as metadata. OTA is
# unsigned, so there is no key and no signing step. A version already published from the same bytes
# is fine (a re-run); from other bytes it's refused: a published version is never replaced.
#
# Needs AWS credentials (the CI role) and the AWS CLI.
set -euo pipefail

usage="usage: ci-publish.sh <sandbox|prod> <nakostat.bin> <x.y.z>"
env=${1:?$usage}
image=${2:?$usage}
version=${3:?$usage}
case "$env" in sandbox | prod) ;; *) echo "env must be sandbox or prod" >&2; exit 2 ;; esac
[[ "$version" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || { echo "version must be x.y.z" >&2; exit 2; }
[ -s "$image" ] || { echo "$image is missing or empty" >&2; exit 1; }
bucket="nakomis-firmware-${env}"
object="nakostat/${version}/firmware.bin"
sha=$(sha256sum "$image" | cut -d' ' -f1)

if existing=$(aws s3api head-object --bucket "$bucket" --key "$object" --query 'Metadata.sha256' --output text 2> /dev/null); then
    if [ "$existing" = "$sha" ]; then
        echo "nakostat ${version} is already published to ${env} with these bytes"
        exit 0
    fi
    echo "s3://${bucket}/${object} already exists with other bytes: a published version is never replaced" >&2
    exit 1
fi
# --if-none-match: never replaced, even by a publish racing this one.
aws s3api put-object --bucket "$bucket" --key "$object" --body "$image" --if-none-match '*' \
    --content-type application/octet-stream --metadata "sha256=${sha}" > /dev/null
echo "published nakostat ${version} (sha256 ${sha}) to s3://${bucket}/${object}"
