/**
 * Alexa Smart Home (payload v3) handler for the Nakostat "Heating" thermostat.
 *
 * Runs in eu-west-1 (Alexa's EU endpoint region) but reads the state table and
 * publishes to IoT Core in eu-west-2, where the rest of nakostat lives. The Pi
 * daemon is the authority: this Lambda never writes state, it only publishes
 * the same `api/setpoint` and `api/mode` messages the web API does, then
 * replies optimistically with the value it asked for.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { MAX_SETPOINT_C, MIN_SETPOINT_C, roundToGrid } from '../shared/limits';

const TARGET_REGION = process.env.TARGET_REGION || 'eu-west-2';
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: TARGET_REGION }));
const iot = new IoTDataPlaneClient({ region: TARGET_REGION });

export const ENDPOINT_ID = 'nakostat-heating';
export const MIN_C = MIN_SETPOINT_C;
export const MAX_C = MAX_SETPOINT_C;
/** Pi state older than this means the house is offline. The Pi publishes every 60 s. */
export const STALE_MS = 5 * 60 * 1000;
/** The heatlink reports every ~60 s; unseen for longer than this means it is offline. */
export const HEATLINK_STALE_MS = 3 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

type Scale = 'CELSIUS' | 'FAHRENHEIT' | 'KELVIN';
interface Temperature {
  value: unknown;
  scale?: Scale;
}

interface DirectiveHeader {
  namespace: string;
  name: string;
  payloadVersion: string;
  messageId: string;
  correlationToken?: string;
}

interface Endpoint {
  endpointId: string;
  scope?: { type: string; token?: string };
  cookie?: Record<string, string>;
}

export interface AlexaEvent {
  directive: {
    header: DirectiveHeader;
    endpoint?: Endpoint;
    // biome-ignore lint/suspicious/noExplicitAny: directive payloads vary by interface
    payload: any;
  };
}

interface Property {
  namespace: string;
  name: string;
  value: unknown;
  timeOfSample: string;
  uncertaintyInMilliseconds: number;
}

// biome-ignore lint/suspicious/noExplicitAny: Alexa response envelope
export type AlexaResponse = { event: any; context?: { properties: Property[] } };

/** The subset of the daemon's `pi/state` payload this skill reads (spec: Daemon state). */
interface HeatlinkState {
  seen?: string;
}

interface PiState {
  timestamp?: string;
  temperature?: number;
  mode?: 'heat' | 'off';
  setpoint?: number;
}

class AlexaError extends Error {
  constructor(
    readonly type: string,
    message: string,
    readonly namespace = 'Alexa',
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const roundHalf = roundToGrid;

function toCelsius(t: Temperature | undefined): number {
  const v = t?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AlexaError('INVALID_VALUE', 'Temperature must be a number');
  }
  switch (t?.scale) {
    case 'FAHRENHEIT':
      return roundHalf(((v - 32) * 5) / 9);
    case 'KELVIN':
      return roundHalf(v - 273.15);
    default:
      return roundHalf(v);
  }
}

function deltaToCelsius(t: Temperature | undefined): number {
  const v = t?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AlexaError('INVALID_VALUE', 'Temperature delta must be a number');
  }
  return t?.scale === 'FAHRENHEIT' ? (v * 5) / 9 : v;
}

const outOfRange = () =>
  new AlexaError(
    'TEMPERATURE_VALUE_OUT_OF_RANGE',
    `Setpoint must be ${MIN_C}–${MAX_C} °C`,
    'Alexa',
    {
      validRange: {
        minimumValue: { value: MIN_C, scale: 'CELSIUS' },
        maximumValue: { value: MAX_C, scale: 'CELSIUS' },
      },
    },
  );

type Verifier = { verify(token: string): Promise<{ sub: string }> };
let verifier: Verifier | undefined;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * Verifies the Cognito access token Alexa got through account linking and
 * returns its `sub`. Signature, expiry, issuer (the shared pool), token_use and
 * client_id (the Alexa app client) are all checked; the JWKS is cached between
 * warm invocations.
 */
async function userIdFrom(token: string | undefined): Promise<string> {
  if (!token) throw new AlexaError('INVALID_AUTHORIZATION_CREDENTIAL', 'No bearer token');
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: env('USER_POOL_ID'),
      tokenUse: 'access',
      clientId: env('ALEXA_CLIENT_ID'),
    }) as unknown as Verifier;
  }
  const v = verifier;
  try {
    const payload = await v.verify(token);
    return payload.sub;
  } catch (e) {
    console.warn('Token verification failed:', (e as Error).message);
    throw new AlexaError('INVALID_AUTHORIZATION_CREDENTIAL', 'Invalid bearer token');
  }
}

async function readItem<T>(deviceId: string): Promise<T | undefined> {
  const res = await dynamo.send(
    new GetCommand({ TableName: env('STATE_TABLE_NAME'), Key: { deviceId } }),
  );
  return res.Item as T | undefined;
}

const readPiState = () => readItem<PiState>('pi');

interface Devices {
  pi?: PiState;
  heatlink?: HeatlinkState;
}

async function readDevices(): Promise<Devices> {
  const [pi, heatlink] = await Promise.all([readPiState(), readItem<HeatlinkState>('heatlink')]);
  return { pi, heatlink };
}

async function publish(topicSuffix: string, body: Record<string, unknown>): Promise<void> {
  const deployEnv = process.env.DEPLOY_ENV || 'sandbox';
  await iot.send(
    new PublishCommand({
      topic: `nakostat/${deployEnv}/api/${topicSuffix}`,
      qos: 1,
      payload: Buffer.from(JSON.stringify(body)),
    }),
  );
}

const within = (iso: string | undefined, ms: number) => !!iso && Date.now() - Date.parse(iso) < ms;

/** Reachable means the Pi state is under 5 min old AND the heatlink was seen under 3 min ago. */
const isReachable = ({ pi, heatlink }: Devices) =>
  within(pi?.timestamp, STALE_MS) && within(heatlink?.seen, HEATLINK_STALE_MS);

function requireReachable(devices: Devices): void {
  if (!isReachable(devices)) {
    throw new AlexaError('ENDPOINT_UNREACHABLE', 'The thermostat is not responding');
  }
}

const sample = (namespace: string, name: string, value: unknown, time: string): Property => ({
  namespace,
  name,
  value,
  timeOfSample: time,
  uncertaintyInMilliseconds: namespace === 'Alexa.EndpointHealth' ? 0 : 60_000,
});

/**
 * Builds context properties from the Pi state, with `overrides` (values this
 * request has just asked for) reported as sampled now.
 */
function properties(
  devices: Devices,
  overrides: { setpoint?: number; mode?: 'heat' | 'off' } = {},
): Property[] {
  const { pi } = devices;
  const now = new Date().toISOString();
  const piTime = pi?.timestamp ?? now;
  const props: Property[] = [];
  const setpoint = overrides.setpoint ?? pi?.setpoint;
  if (typeof setpoint === 'number') {
    props.push(
      sample(
        'Alexa.ThermostatController',
        'targetSetpoint',
        { value: setpoint, scale: 'CELSIUS' },
        overrides.setpoint !== undefined ? now : piTime,
      ),
    );
  }
  const mode = overrides.mode ?? pi?.mode;
  if (mode === 'heat' || mode === 'off') {
    props.push(
      sample(
        'Alexa.ThermostatController',
        'thermostatMode',
        mode === 'heat' ? 'HEAT' : 'OFF',
        overrides.mode !== undefined ? now : piTime,
      ),
    );
  }
  if (typeof pi?.temperature === 'number') {
    props.push(
      sample(
        'Alexa.TemperatureSensor',
        'temperature',
        { value: pi.temperature, scale: 'CELSIUS' },
        piTime,
      ),
    );
  }
  props.push(
    sample(
      'Alexa.EndpointHealth',
      'connectivity',
      { value: isReachable(devices) ? 'OK' : 'UNREACHABLE' },
      now,
    ),
  );
  return props;
}

function respond(
  d: AlexaEvent['directive'],
  name: 'Response' | 'StateReport',
  props: Property[],
): AlexaResponse {
  return {
    event: {
      header: {
        namespace: 'Alexa',
        name,
        payloadVersion: '3',
        messageId: randomUUID(),
        correlationToken: d.header.correlationToken,
      },
      endpoint: d.endpoint,
      payload: {},
    },
    context: { properties: props },
  };
}

function errorResponse(d: AlexaEvent['directive'] | undefined, err: AlexaError): AlexaResponse {
  return {
    event: {
      header: {
        namespace: err.namespace,
        name: 'ErrorResponse',
        payloadVersion: '3',
        messageId: randomUUID(),
        correlationToken: d?.header?.correlationToken,
      },
      endpoint: d?.endpoint,
      payload: { type: err.type, message: err.message, ...err.extra },
    },
  };
}

// ── Discovery ────────────────────────────────────────────────────────────────

export const HEATING_ENDPOINT = {
  endpointId: ENDPOINT_ID,
  manufacturerName: 'Nakomis',
  friendlyName: 'Heating',
  description: 'Nakostat smart thermostat',
  displayCategories: ['THERMOSTAT', 'TEMPERATURE_SENSOR'],
  capabilities: [
    {
      type: 'AlexaInterface',
      interface: 'Alexa.ThermostatController',
      version: '3',
      properties: {
        supported: [{ name: 'targetSetpoint' }, { name: 'thermostatMode' }],
        proactivelyReported: false,
        retrievable: true,
      },
      configuration: { supportedModes: ['HEAT', 'OFF'], supportsScheduling: false },
    },
    {
      type: 'AlexaInterface',
      interface: 'Alexa.TemperatureSensor',
      version: '3',
      properties: {
        supported: [{ name: 'temperature' }],
        proactivelyReported: false,
        retrievable: true,
      },
    },
    {
      type: 'AlexaInterface',
      interface: 'Alexa.EndpointHealth',
      version: '3',
      properties: {
        supported: [{ name: 'connectivity' }],
        proactivelyReported: false,
        retrievable: true,
      },
    },
    { type: 'AlexaInterface', interface: 'Alexa', version: '3' },
  ],
};

async function discover(d: AlexaEvent['directive']): Promise<AlexaResponse> {
  let endpoints: (typeof HEATING_ENDPOINT)[] = [HEATING_ENDPOINT];
  try {
    await userIdFrom(d.payload?.scope?.token);
  } catch {
    // Alexa's guidance: on a bad token during discovery, return no endpoints rather than an error.
    endpoints = [];
  }
  return {
    event: {
      header: {
        namespace: 'Alexa.Discovery',
        name: 'Discover.Response',
        payloadVersion: '3',
        messageId: randomUUID(),
      },
      payload: { endpoints },
    },
  };
}

// ── Directive handlers ───────────────────────────────────────────────────────

async function setTargetTemperature(d: AlexaEvent['directive'], userId: string) {
  const p = d.payload ?? {};
  if (p.lowerSetpoint || p.upperSetpoint) {
    throw new AlexaError(
      'DUAL_SETPOINTS_UNSUPPORTED',
      'Only a single setpoint is supported',
      'Alexa.ThermostatController',
    );
  }
  const celsius = toCelsius(p.targetSetpoint);
  if (celsius < MIN_C || celsius > MAX_C) throw outOfRange();
  const devices = await readDevices();
  requireReachable(devices);
  await publish('setpoint', {
    temperature: celsius,
    timestamp: new Date().toISOString(),
    userId,
  });
  return respond(d, 'Response', properties(devices, { setpoint: celsius }));
}

async function adjustTargetTemperature(d: AlexaEvent['directive'], userId: string) {
  const delta = deltaToCelsius(d.payload?.targetSetpointDelta);
  const devices = await readDevices();
  requireReachable(devices);
  const pi = devices.pi;
  if (typeof pi?.setpoint !== 'number') {
    throw new AlexaError('ENDPOINT_UNREACHABLE', 'Current setpoint unknown');
  }
  const celsius = roundHalf(pi.setpoint + delta);
  if (celsius < MIN_C || celsius > MAX_C) throw outOfRange();
  await publish('setpoint', {
    temperature: celsius,
    timestamp: new Date().toISOString(),
    userId,
  });
  return respond(d, 'Response', properties(devices, { setpoint: celsius }));
}

async function setThermostatMode(d: AlexaEvent['directive'], userId: string) {
  const requested = d.payload?.thermostatMode?.value;
  if (requested !== 'HEAT' && requested !== 'OFF') {
    throw new AlexaError(
      'UNSUPPORTED_THERMOSTAT_MODE',
      `Mode ${String(requested)} is not supported; use HEAT or OFF`,
      'Alexa.ThermostatController',
    );
  }
  const mode = requested === 'HEAT' ? 'heat' : 'off';
  const devices = await readDevices();
  requireReachable(devices);
  await publish('mode', { mode, timestamp: new Date().toISOString(), userId });
  return respond(d, 'Response', properties(devices, { mode }));
}

async function reportState(d: AlexaEvent['directive']) {
  const devices = await readDevices();
  if (!devices.pi) throw new AlexaError('ENDPOINT_UNREACHABLE', 'No state from the thermostat yet');
  return respond(d, 'StateReport', properties(devices));
}

// ── Entry point ──────────────────────────────────────────────────────────────

export const handler = async (event: AlexaEvent): Promise<AlexaResponse> => {
  const d = event?.directive;
  try {
    if (!d?.header?.namespace) throw new AlexaError('INVALID_DIRECTIVE', 'Malformed directive');
    const { namespace, name } = d.header;

    if (namespace === 'Alexa.Discovery' && name === 'Discover') return await discover(d);

    if (namespace === 'Alexa.Authorization' && name === 'AcceptGrant') {
      // No proactive ChangeReports yet, so the grant code isn't exchanged; just acknowledge.
      return {
        event: {
          header: {
            namespace: 'Alexa.Authorization',
            name: 'AcceptGrant.Response',
            payloadVersion: '3',
            messageId: randomUUID(),
          },
          payload: {},
        },
      };
    }

    const known =
      (namespace === 'Alexa' && name === 'ReportState') ||
      (namespace === 'Alexa.ThermostatController' &&
        ['SetTargetTemperature', 'AdjustTargetTemperature', 'SetThermostatMode'].includes(name));
    if (!known)
      throw new AlexaError('INVALID_DIRECTIVE', `Unsupported directive ${namespace}.${name}`);

    const userId = await userIdFrom(d.endpoint?.scope?.token);
    if (d.endpoint?.endpointId !== ENDPOINT_ID) {
      throw new AlexaError('NO_SUCH_ENDPOINT', `Unknown endpoint ${d.endpoint?.endpointId}`);
    }

    switch (name) {
      case 'ReportState':
        return await reportState(d);
      case 'SetTargetTemperature':
        return await setTargetTemperature(d, userId);
      case 'AdjustTargetTemperature':
        return await adjustTargetTemperature(d, userId);
      default:
        return await setThermostatMode(d, userId);
    }
  } catch (e) {
    if (e instanceof AlexaError) return errorResponse(d, e);
    console.error('Unhandled error:', e);
    return errorResponse(d, new AlexaError('INTERNAL_ERROR', 'Internal error'));
  }
};
