#!/usr/bin/env bash
# Populates secrets/pi/secrets.toml, secrets/pi/cert.pem, and secrets/pi/key.pem
# from AWS IoT Core and SSM Parameter Store.
#
# Requires: aws CLI, jq, sed
# AWS_PROFILE must be set (e.g. nakom.is-sandbox or nakom.is).
# NPM_ENVIRONMENT must be set (sandbox or prod).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRETS_DIR="${REPO_ROOT}/secrets/pi"
TEMPLATE="${SECRETS_DIR}/secrets.toml.template"
TARGET="${SECRETS_DIR}/secrets.toml"

if [[ -z "${NPM_ENVIRONMENT:-}" ]]; then
  echo "Error: NPM_ENVIRONMENT is not set. Use 'sandbox' or 'prod'." >&2
  exit 1
fi

ENV="${NPM_ENVIRONMENT}"

if [[ ! -d "${SECRETS_DIR}" ]]; then
  echo "Error: secrets/pi directory not found. Is the superprivatesecretrepo symlinked?" >&2
  echo "Expected: ${SECRETS_DIR}" >&2
  exit 1
fi

# Copy template if secrets.toml doesn't exist yet (preserves manual edits)
if [[ ! -f "${TARGET}" ]]; then
  if [[ ! -f "${TEMPLATE}" ]]; then
    echo "Error: ${TEMPLATE} not found." >&2
    exit 1
  fi
  echo "Creating ${TARGET} from template..."
  cp "${TEMPLATE}" "${TARGET}"
fi

# Fetch IoT endpoint
echo "Fetching IoT endpoint..."
IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query 'endpointAddress' --output text)
echo "  endpoint: ${IOT_ENDPOINT}"

# Patch endpoint into secrets.toml (only the managed field)
sed -i.bak "s|^endpoint = .*|endpoint = \"${IOT_ENDPOINT}\"|" "${TARGET}"
rm -f "${TARGET}.bak"

# Fetch and write cert + key from SSM
echo "Fetching certificate from SSM..."
aws ssm get-parameter \
  --name "/nakostat/${ENV}/pi/certPem" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text > "${SECRETS_DIR}/cert.pem"
echo "  written: ${SECRETS_DIR}/cert.pem"

echo "Fetching private key from SSM..."
aws ssm get-parameter \
  --name "/nakostat/${ENV}/pi/privKey" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text > "${SECRETS_DIR}/key.pem"
echo "  written: ${SECRETS_DIR}/key.pem"

echo "Done. Pi secrets populated for environment: ${ENV}"
