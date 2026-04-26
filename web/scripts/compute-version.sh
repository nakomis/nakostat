#!/bin/bash

# Computes the next semantic version for the web app.
#
# Reads the latest deployed version from the NAKO-32 deployment tracker API,
# then bumps based on commit message keywords:
#   --bump-major  →  major bump (x.0.0)
#   --bump-minor  →  minor bump (0.x.0)
#   (default)     →  patch bump (0.0.x)
#
# Writes the result to src/version.json.

set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
VERSION_FILE="$SCRIPT_DIR/../src/version.json"

ENV="${NPM_ENVIRONMENT:-sandbox}"

TRACKER_URL=$(aws ssm get-parameter \
  --name "/nakostat/${ENV}/deployment-tracker/url" \
  --query "Parameter.Value" --output text 2>/dev/null || echo "")

if [[ -n "$TRACKER_URL" ]]; then
  LATEST_VERSION=$(aws lambda invoke \
    --function-name "$(aws ssm get-parameter \
      --name "/nakostat/${ENV}/deployment-tracker/function-name" \
      --query "Parameter.Value" --output text)" \
    --payload '{"httpMethod":"GET","path":"/latest","queryStringParameters":{"component":"web"}}' \
    /dev/stdout 2>/dev/null \
    | jq -r '.body | fromjson | .version' 2>/dev/null || echo "")
fi

CURRENT_VERSION="${LATEST_VERSION:-$(jq -r '.version' "$VERSION_FILE")}"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
MAJOR="${MAJOR:-0}"
MINOR="${MINOR:-1}"
PATCH="${PATCH:-0}"

COMMIT_MSG="${COMMIT_MESSAGE:-$(git log -1 --pretty=%B 2>/dev/null || echo "")}"

if echo "$COMMIT_MSG" | grep -q -- '--bump-major'; then
  MAJOR=$((MAJOR + 1))
  MINOR=0
  PATCH=0
elif echo "$COMMIT_MSG" | grep -q -- '--bump-minor'; then
  MINOR=$((MINOR + 1))
  PATCH=0
else
  PATCH=$((PATCH + 1))
fi

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "{ \"version\": \"${NEW_VERSION}\" }" > "$VERSION_FILE"
echo "Version: $CURRENT_VERSION → $NEW_VERSION"
