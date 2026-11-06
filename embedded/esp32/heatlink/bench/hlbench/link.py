"""MQTT to IoT Core from the Mac (STAT-82): SigV4 over WebSocket with the AWS profile's IAM rights, so
no device certificate (and no clash with the heatlink's own client ID). Credentials come from boto3,
which handles SSO profiles and refreshes them; IoT Core drops a WebSocket connection after 24 h, and
the reconnect needs a live SSO session (aws sso login).
"""

import json
import queue
import time
import uuid

import boto3
from awscrt import auth, mqtt
from awsiot import mqtt_connection_builder
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError


class Link:
    def __init__(self, thing: str, profile: str | None, region: str = "eu-west-2"):
        self.thing = thing
        self.prefix = f"nakostat/{thing}"
        self.messages: queue.Queue = queue.Queue()   # (arrived, kind, payload dict or str)
        self.login = f"aws sso login --profile {profile}"
        session = boto3.Session(profile_name=profile, region_name=region)
        try:
            endpoint = session.client("iot").describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
        except (BotoCoreError, ClientError) as e:
            raise SystemExit(f"{e}\n(an expired SSO session? {self.login})") from None

        def credentials():
            # On awscrt's thread, at each (re)connect. boto3 refreshes SSO role credentials itself, from
            # the cached SSO token, until that token runs out.
            try:
                found = session.get_credentials()
                if found is None:
                    raise NoCredentialsError()
                c = found.get_frozen_credentials()
            except BotoCoreError as e:
                # Say so, then let awscrt keep retrying: an aws sso login brings it back.
                self._note("link", f"no AWS credentials ({e.__class__.__name__}): {self.login}")
                raise
            return auth.AwsCredentials(c.access_key, c.secret_key, c.token)

        self.conn = mqtt_connection_builder.websockets_with_default_aws_signing(
            endpoint=endpoint, region=region, credentials_provider=auth.AwsCredentialsProvider.new_delegate(credentials),
            client_id=f"nakostat-bench-{uuid.uuid4().hex[:8]}", clean_session=True, keep_alive_secs=30,
            on_connection_interrupted=lambda conn, error, **kw: self._note("link", f"connection lost: {error}"),
            on_connection_resumed=self._resumed)

    def _note(self, kind, text):
        self.messages.put((time.time(), kind, text))

    def _resumed(self, connection, return_code, session_present, **kw):
        self._note("link", "reconnected")
        if not session_present:
            # Never wait here: the SUBACK is handled on this same thread.
            future, _ = self.conn.subscribe(f"{self.prefix}/#", mqtt.QoS.AT_LEAST_ONCE, self._on_message)
            future.add_done_callback(lambda f: f.exception() and self._note("link", f"resubscribe failed: {f.exception()}"))

    def _on_message(self, topic, payload, **kw):
        try:
            body = json.loads(payload)
        except ValueError:
            body = payload.decode(errors="replace")
        self.messages.put((time.time(), topic.rsplit("/", 1)[-1], body))

    def open(self):
        self.conn.connect().result(timeout=30)
        future, _ = self.conn.subscribe(f"{self.prefix}/#", mqtt.QoS.AT_LEAST_ONCE, self._on_message)
        future.result(timeout=15)
        return self

    def close(self):
        self.conn.disconnect().result(timeout=10)

    def send(self, command: dict):
        self.conn.publish(f"{self.prefix}/commands", json.dumps(command, separators=(",", ":")),
                          mqtt.QoS.AT_LEAST_ONCE)
