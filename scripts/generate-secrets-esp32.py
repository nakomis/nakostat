#!/usr/bin/env python3
"""
Generates embedded/esp32/include/secrets.h from AWS SSM and IoT Core.

Requires:
  pip install boto3
  AWS_PROFILE set to nakom.is-sandbox or nakom.is
  NPM_ENVIRONMENT set to sandbox or prod
"""

import os
import sys
import textwrap
from pathlib import Path

import boto3

REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_H = REPO_ROOT / "embedded" / "esp32" / "include" / "secrets.h"
ROOT_CA_PATH = REPO_ROOT / "AmazonRootCA1.pem"


def fatal(msg: str) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    env = os.environ.get("NPM_ENVIRONMENT")
    if not env:
        fatal("NPM_ENVIRONMENT is not set. Use 'sandbox' or 'prod'.")
    if env not in ("sandbox", "prod"):
        fatal(f"Unknown NPM_ENVIRONMENT '{env}'. Must be 'sandbox' or 'prod'.")

    ssm = boto3.client("ssm")
    iot = boto3.client("iot")

    print(f"Fetching ESP32 secrets for environment: {env}")

    cert_pem = ssm.get_parameter(
        Name=f"/nakostat/{env}/esp32/certPem", WithDecryption=True
    )["Parameter"]["Value"]
    print("  fetched: certPem")

    priv_key = ssm.get_parameter(
        Name=f"/nakostat/{env}/esp32/privKey", WithDecryption=True
    )["Parameter"]["Value"]
    print("  fetched: privKey")

    iot_endpoint = iot.describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
    print(f"  iot endpoint: {iot_endpoint}")

    if not ROOT_CA_PATH.exists():
        fatal(f"AmazonRootCA1.pem not found at {ROOT_CA_PATH}. Download it from AWS.")
    root_ca = ROOT_CA_PATH.read_text()
    print(f"  read: {ROOT_CA_PATH}")

    def escape_pem(pem: str) -> str:
        lines = pem.strip().splitlines()
        return "\\n\"\n        \"".join(lines) + "\\n"

    header = textwrap.dedent(f"""\
        // AUTO-GENERATED — do not edit. Run scripts/generate-secrets-esp32.py to regenerate.
        #pragma once

        #define MQTT_BROKER "{iot_endpoint}"
        #define MQTT_PORT 8883
        #define MQTT_CLIENT_ID "nakostat-esp32-{env}"

        #define MQTT_TOPIC_STATUS "nakostat/{env}/esp32/status"
        #define MQTT_TOPIC_COMMAND "nakostat/{env}/esp32/command"

        static const char ROOT_CA[] =
            "{escape_pem(root_ca)}";

        static const char CERT_PEM[] =
            "{escape_pem(cert_pem)}";

        static const char PRIV_KEY[] =
            "{escape_pem(priv_key)}";
    """)

    SECRETS_H.parent.mkdir(parents=True, exist_ok=True)
    SECRETS_H.write_text(header)
    print(f"Written: {SECRETS_H}")


if __name__ == "__main__":
    main()
