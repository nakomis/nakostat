#!/usr/bin/env bash
# STAT-81: make the RSA-3072 key that signs heatlink firmware (the secure boot v2 scheme), once per
# environment. Adapted from tinycrypt's infra/scripts/ota-signing-key.sh. Refuses if one exists:
# replacing it would strand every heatlink in the field, since a heatlink only accepts an update signed
# by the key that signed the image it's running.
#
#   embedded/esp32/heatlink/scripts/ota-signing-key.sh
#
# The key lives in SSM Parameter Store, /nakostat/{env}/ota/signing-key (SecureString under the
# account's free aws/ssm key: the master copy, which CI reads), and in the login Keychain (service
# nakostat-ota-signing, account {env}, base64) for esp32s3/scripts/sign.sh. Only its public half goes
# in the repo (esp32s3/ota-signing/{env}.pub.pem: commit it); the private PEM made here is deleted,
# and never passed on a command line.
#
# Needs AWS_PROFILE (default nakom.is-sandbox) and NPM_ENVIRONMENT (default sandbox).
set -euo pipefail
umask 077

env=${NPM_ENVIRONMENT:-sandbox}
case "$env" in sandbox | prod) ;; *) echo "NPM_ENVIRONMENT must be sandbox or prod" >&2; exit 2 ;; esac
export AWS_PROFILE=${AWS_PROFILE:-nakom.is-sandbox}
export AWS_REGION=${AWS_REGION:-eu-west-2}
param="/nakostat/${env}/ota/signing-key"
service=nakostat-ota-signing

if aws ssm get-parameter --name "$param" > /dev/null 2>&1; then
    echo "$param already exists; not replacing it" >&2
    exit 1
fi
if security find-generic-password -s "$service" -a "$env" > /dev/null 2>&1; then
    echo "Keychain already has $service/$env; not replacing it" >&2
    exit 1
fi

IDF_PATH="${IDF_PATH:-$HOME/esp/v5.5/esp-idf}"
# shellcheck disable=SC1091
. "$IDF_PATH/export.sh" > /dev/null

dir=$(mktemp -d)
trap 'rm -P "$dir"/* 2>/dev/null; rmdir "$dir"' EXIT
espsecure.py generate_signing_key --version 2 --scheme rsa3072 "$dir/key.pem" > /dev/null

# The public half first: if anything after SSM fails, sign.sh can still restore the Keychain from SSM.
pub="$(cd "$(dirname "$0")/.." && pwd)/esp32s3/ota-signing/${env}.pub.pem"
mkdir -p "$(dirname "$pub")"
espsecure.py extract_public_key --version 2 --keyfile "$dir/key.pem" "$pub" > /dev/null
chmod 644 "$pub"
aws ssm put-parameter --name "$param" --type SecureString --value "file://$dir/key.pem" \
    --description "nakostat heatlink firmware signing key (RSA-3072, secure boot v2 scheme)" > /dev/null
# Through security's stdin, not its argv (where ps would show it). Base64 needs no quoting.
printf 'add-generic-password -s %s -a %s -T /usr/bin/security -j "%s" -w %s\n' "$service" "$env" \
    "nakostat heatlink firmware signing key ($env); master copy in SSM $param" "$(base64 < "$dir/key.pem" | tr -d '\n')" |
    security -i

digest=$(espsecure.py digest_sbv2_public_key --keyfile "$dir/key.pem" --output "$dir/digest.bin" > /dev/null && xxd -p -c 64 "$dir/digest.bin")
echo "made $param and Keychain $service/$env; public key digest $digest"
echo "commit $pub"
