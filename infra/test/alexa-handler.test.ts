import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const mockVerify = jest.fn();
const mockCreate = jest.fn((_opts: unknown) => ({ verify: mockVerify }));
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: (opts: unknown) => mockCreate(opts) },
}));

import { ENDPOINT_ID, handler } from '../lambda/alexa/handler';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const iotMock = mockClient(IoTDataPlaneClient);

const NOW = new Date('2026-10-19T12:00:00.000Z');
const FRESH = '2026-10-19T11:58:00.000Z'; // 2 min old
const STALE = '2026-10-19T11:50:00.000Z'; // 10 min old
const HL_FRESH = '2026-10-19T11:59:00.000Z'; // 1 min old
const HL_STALE = '2026-10-19T11:56:00.000Z'; // 4 min old

const piState = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'pi',
  timestamp: FRESH,
  temperature: 19.8,
  humidity: 45.2,
  mode: 'heat',
  setpoint: 20.5,
  scheduled_setpoint: 20.0,
  override: null,
  demand: true,
  demand_source: 'schedule',
  heatlink: null,
  ...overrides,
});

const header = (namespace: string, name: string) => ({
  namespace,
  name,
  payloadVersion: '3',
  messageId: 'msg-1',
  correlationToken: 'corr-1',
});

const endpoint = { endpointId: ENDPOINT_ID, scope: { type: 'BearerToken', token: 'tok' } };

const directive = (namespace: string, name: string, payload: Record<string, unknown> = {}) => ({
  directive: { header: header(namespace, name), endpoint, payload },
});

// biome-ignore lint/suspicious/noExplicitAny: test helper reading loosely-typed responses
const prop = (res: any, namespace: string, name: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: as above
  res.context?.properties?.find((p: any) => p.namespace === namespace && p.name === name);

// biome-ignore lint/suspicious/noExplicitAny: as above
const publishes = (): Array<{ topic: string; payload: any }> =>
  iotMock.commandCalls(PublishCommand).map((c) => ({
    topic: c.args[0].input.topic as string,
    payload: JSON.parse(Buffer.from(c.args[0].input.payload as Uint8Array).toString()),
  }));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  dynamoMock.reset();
  iotMock.reset();
  mockVerify.mockReset();
  mockVerify.mockResolvedValue({ sub: 'user-123', token_use: 'access' });
  process.env.STATE_TABLE_NAME = 'nakostat-state-sandbox';
  process.env.DEPLOY_ENV = 'sandbox';
  process.env.USER_POOL_ID = 'eu-west-2_TEST';
  process.env.ALEXA_CLIENT_ID = 'alexa-client';
  dynamoMock.on(GetCommand, { Key: { deviceId: 'pi' } }).resolves({ Item: piState() });
  dynamoMock
    .on(GetCommand, { Key: { deviceId: 'heatlink' } })
    .resolves({ Item: { deviceId: 'heatlink', seen: HL_FRESH, relay: true } });
  iotMock.on(PublishCommand).resolves({});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('token verification', () => {
  test('verifies against the shared pool as an access token for the Alexa client', async () => {
    await handler(directive('Alexa', 'ReportState'));
    expect(mockCreate).toHaveBeenCalledWith({
      userPoolId: 'eu-west-2_TEST',
      tokenUse: 'access',
      clientId: 'alexa-client',
    });
    expect(mockVerify).toHaveBeenCalledWith('tok');
  });

  test('rejects an invalid token with INVALID_AUTHORIZATION_CREDENTIAL', async () => {
    mockVerify.mockRejectedValue(new Error('bad signature'));
    const res = await handler(
      directive('Alexa.ThermostatController', 'SetTargetTemperature', {
        targetSetpoint: { value: 21, scale: 'CELSIUS' },
      }),
    );
    expect(res.event.header.name).toBe('ErrorResponse');
    expect(res.event.payload.type).toBe('INVALID_AUTHORIZATION_CREDENTIAL');
    expect(publishes()).toHaveLength(0);
  });

  test('rejects a missing token', async () => {
    const d = directive('Alexa', 'ReportState');
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
    (d.directive.endpoint as any) = { endpointId: ENDPOINT_ID };
    const res = await handler(d);
    expect(res.event.payload.type).toBe('INVALID_AUTHORIZATION_CREDENTIAL');
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('Alexa.Discovery', () => {
  const discover = (token = 'tok') => ({
    directive: {
      header: {
        namespace: 'Alexa.Discovery',
        name: 'Discover',
        payloadVersion: '3',
        messageId: 'm',
      },
      payload: { scope: { type: 'BearerToken', token } },
    },
  });

  test('returns one Heating thermostat endpoint', async () => {
    const res = await handler(discover());
    expect(res.event.header).toMatchObject({
      namespace: 'Alexa.Discovery',
      name: 'Discover.Response',
      payloadVersion: '3',
    });
    expect(res.event.header.messageId).toEqual(expect.any(String));
    const endpoints = res.event.payload.endpoints;
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      endpointId: ENDPOINT_ID,
      friendlyName: 'Heating',
      displayCategories: ['THERMOSTAT', 'TEMPERATURE_SENSOR'],
    });
  });

  test('declares the thermostat, sensor, health and Alexa capabilities', async () => {
    const res = await handler(discover());
    const caps = res.event.payload.endpoints[0].capabilities;
    // biome-ignore lint/suspicious/noExplicitAny: loosely-typed capability list
    const cap = (i: string) => caps.find((c: any) => c.interface === i);
    expect(cap('Alexa')).toMatchObject({ type: 'AlexaInterface', version: '3' });
    expect(cap('Alexa.ThermostatController')).toMatchObject({
      properties: {
        supported: [{ name: 'targetSetpoint' }, { name: 'thermostatMode' }],
        retrievable: true,
        proactivelyReported: false,
      },
      configuration: { supportedModes: ['HEAT', 'OFF'], supportsScheduling: false },
    });
    expect(cap('Alexa.TemperatureSensor')).toMatchObject({
      properties: { supported: [{ name: 'temperature' }], retrievable: true },
    });
    expect(cap('Alexa.EndpointHealth')).toMatchObject({
      properties: { supported: [{ name: 'connectivity' }], retrievable: true },
    });
  });

  test('verifies the discovery token from payload.scope', async () => {
    await handler(discover('disc-tok'));
    expect(mockVerify).toHaveBeenCalledWith('disc-tok');
  });

  test('returns no endpoints when the token is invalid', async () => {
    mockVerify.mockRejectedValue(new Error('expired'));
    const res = await handler(discover());
    expect(res.event.header.name).toBe('Discover.Response');
    expect(res.event.payload.endpoints).toEqual([]);
  });
});

describe('Alexa.Authorization AcceptGrant', () => {
  test('acknowledges the grant', async () => {
    const res = await handler({
      directive: {
        header: {
          namespace: 'Alexa.Authorization',
          name: 'AcceptGrant',
          payloadVersion: '3',
          messageId: 'm',
        },
        payload: {
          grant: { type: 'OAuth2.AuthorizationCode', code: 'abc' },
          grantee: { type: 'BearerToken', token: 'tok' },
        },
      },
    });
    expect(res.event.header).toMatchObject({
      namespace: 'Alexa.Authorization',
      name: 'AcceptGrant.Response',
    });
    expect(res.event.payload).toEqual({});
  });
});

describe('Alexa ReportState', () => {
  test('reports setpoint, mode, temperature and connectivity', async () => {
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(res.event.header).toMatchObject({
      namespace: 'Alexa',
      name: 'StateReport',
      correlationToken: 'corr-1',
    });
    expect(res.event.endpoint).toEqual(endpoint);
    expect(prop(res, 'Alexa.ThermostatController', 'targetSetpoint').value).toEqual({
      value: 20.5,
      scale: 'CELSIUS',
    });
    expect(prop(res, 'Alexa.ThermostatController', 'thermostatMode').value).toBe('HEAT');
    expect(prop(res, 'Alexa.TemperatureSensor', 'temperature').value).toEqual({
      value: 19.8,
      scale: 'CELSIUS',
    });
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({ value: 'OK' });
    expect(prop(res, 'Alexa.TemperatureSensor', 'temperature').timeOfSample).toBe(FRESH);
  });

  test('reads deviceId "pi" from the state table', async () => {
    await handler(directive('Alexa', 'ReportState'));
    const calls = dynamoMock.commandCalls(GetCommand);
    expect(calls[0].args[0].input).toEqual({
      TableName: 'nakostat-state-sandbox',
      Key: { deviceId: 'pi' },
    });
  });

  test('reports OFF mode', async () => {
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ mode: 'off', setpoint: 7 }) });
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(prop(res, 'Alexa.ThermostatController', 'thermostatMode').value).toBe('OFF');
  });

  test('reports UNREACHABLE when the Pi state is older than 5 minutes', async () => {
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ timestamp: STALE }) });
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({
      value: 'UNREACHABLE',
    });
  });

  test('omits properties the Pi has not reported', async () => {
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ temperature: undefined }) });
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(prop(res, 'Alexa.TemperatureSensor', 'temperature')).toBeUndefined();
    expect(prop(res, 'Alexa.ThermostatController', 'targetSetpoint')).toBeDefined();
  });

  test('returns ENDPOINT_UNREACHABLE when there is no Pi state', async () => {
    dynamoMock.on(GetCommand, { Key: { deviceId: 'pi' } }).resolves({});
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(res.event.header.name).toBe('ErrorResponse');
    expect(res.event.payload.type).toBe('ENDPOINT_UNREACHABLE');
  });

  test('returns INTERNAL_ERROR when misconfigured', async () => {
    delete process.env.STATE_TABLE_NAME;
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(res.event.payload.type).toBe('INTERNAL_ERROR');
  });

  test('returns INTERNAL_ERROR when DynamoDB fails', async () => {
    dynamoMock.on(GetCommand).rejects(new Error('boom'));
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(res.event.payload.type).toBe('INTERNAL_ERROR');
  });
});

describe('SetTargetTemperature', () => {
  const set = (value: number, scale = 'CELSIUS') =>
    directive('Alexa.ThermostatController', 'SetTargetTemperature', {
      targetSetpoint: { value, scale },
    });

  test('publishes the api/setpoint contract payload', async () => {
    const res = await handler(set(21));
    expect(publishes()).toEqual([
      {
        topic: 'nakostat/sandbox/api/setpoint',
        payload: { temperature: 21, timestamp: NOW.toISOString(), userId: 'user-123' },
      },
    ]);
    expect(res.event.header).toMatchObject({ namespace: 'Alexa', name: 'Response' });
    expect(prop(res, 'Alexa.ThermostatController', 'targetSetpoint')).toMatchObject({
      value: { value: 21, scale: 'CELSIUS' },
      timeOfSample: NOW.toISOString(),
    });
    expect(prop(res, 'Alexa.ThermostatController', 'thermostatMode').value).toBe('HEAT');
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({ value: 'OK' });
  });

  test('publishes with QoS 1', async () => {
    await handler(set(21));
    expect(iotMock.commandCalls(PublishCommand)[0].args[0].input.qos).toBe(1);
  });

  test('converts Fahrenheit to Celsius, to the nearest half degree', async () => {
    await handler(set(70, 'FAHRENHEIT')); // 21.11 °C
    expect(publishes()[0].payload.temperature).toBe(21);
  });

  test('converts Kelvin to Celsius', async () => {
    await handler(set(294.15, 'KELVIN'));
    expect(publishes()[0].payload.temperature).toBe(21);
  });

  test('accepts the range limits', async () => {
    await handler(set(5));
    await handler(set(30));
    expect(publishes().map((p) => p.payload.temperature)).toEqual([5, 30]);
  });

  test.each([4.5, 30.5, 100])('rejects %p °C as out of range', async (value) => {
    const res = await handler(set(value));
    expect(res.event.header).toMatchObject({ namespace: 'Alexa', name: 'ErrorResponse' });
    expect(res.event.payload).toMatchObject({
      type: 'TEMPERATURE_VALUE_OUT_OF_RANGE',
      validRange: {
        minimumValue: { value: 5, scale: 'CELSIUS' },
        maximumValue: { value: 30, scale: 'CELSIUS' },
      },
    });
    expect(publishes()).toHaveLength(0);
  });

  test('rejects an out-of-range Fahrenheit value', async () => {
    const res = await handler(set(95, 'FAHRENHEIT'));
    expect(res.event.payload.type).toBe('TEMPERATURE_VALUE_OUT_OF_RANGE');
  });

  test('rejects dual setpoints', async () => {
    const res = await handler(
      directive('Alexa.ThermostatController', 'SetTargetTemperature', {
        lowerSetpoint: { value: 18, scale: 'CELSIUS' },
        upperSetpoint: { value: 22, scale: 'CELSIUS' },
      }),
    );
    expect(res.event.header).toMatchObject({
      namespace: 'Alexa.ThermostatController',
      name: 'ErrorResponse',
    });
    expect(res.event.payload.type).toBe('DUAL_SETPOINTS_UNSUPPORTED');
  });

  test('rejects a non-numeric value', async () => {
    const res = await handler(
      directive('Alexa.ThermostatController', 'SetTargetTemperature', {
        targetSetpoint: { value: 'warm', scale: 'CELSIUS' },
      }),
    );
    expect(res.event.payload.type).toBe('INVALID_VALUE');
  });

  test('returns INTERNAL_ERROR when the publish fails', async () => {
    iotMock.on(PublishCommand).rejects(new Error('iot down'));
    const res = await handler(set(21));
    expect(res.event.payload.type).toBe('INTERNAL_ERROR');
  });
});

describe('AdjustTargetTemperature', () => {
  const adjust = (value: number, scale = 'CELSIUS') =>
    directive('Alexa.ThermostatController', 'AdjustTargetTemperature', {
      targetSetpointDelta: { value, scale },
    });

  test('adds the delta to the current effective setpoint', async () => {
    const res = await handler(adjust(1));
    expect(publishes()[0]).toEqual({
      topic: 'nakostat/sandbox/api/setpoint',
      payload: { temperature: 21.5, timestamp: NOW.toISOString(), userId: 'user-123' },
    });
    expect(prop(res, 'Alexa.ThermostatController', 'targetSetpoint').value).toEqual({
      value: 21.5,
      scale: 'CELSIUS',
    });
  });

  test('handles negative deltas', async () => {
    await handler(adjust(-2));
    expect(publishes()[0].payload.temperature).toBe(18.5);
  });

  test('converts a Fahrenheit delta (no offset)', async () => {
    await handler(adjust(-2, 'FAHRENHEIT')); // -1.11 °C → 19.39 → 19.5
    expect(publishes()[0].payload.temperature).toBe(19.5);
  });

  test('rejects an adjustment outside 5-30 C with TEMPERATURE_VALUE_OUT_OF_RANGE', async () => {
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ setpoint: 29.5 }) });
    const high = await handler(adjust(3));
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ setpoint: 6 }) });
    const low = await handler(adjust(-3));
    for (const res of [high, low]) {
      expect(res.event.payload.type).toBe('TEMPERATURE_VALUE_OUT_OF_RANGE');
      expect(res.event.payload.validRange).toEqual({
        minimumValue: { value: 5, scale: 'CELSIUS' },
        maximumValue: { value: 30, scale: 'CELSIUS' },
      });
    }
    expect(publishes()).toHaveLength(0);
  });

  test('returns ENDPOINT_UNREACHABLE without a current setpoint', async () => {
    dynamoMock
      .on(GetCommand, { Key: { deviceId: 'pi' } })
      .resolves({ Item: piState({ setpoint: undefined }) });
    const res = await handler(adjust(1));
    expect(res.event.payload.type).toBe('ENDPOINT_UNREACHABLE');
    expect(publishes()).toHaveLength(0);
  });

  test('rejects a non-numeric delta', async () => {
    const res = await handler(
      directive('Alexa.ThermostatController', 'AdjustTargetTemperature', {
        targetSetpointDelta: { value: null, scale: 'CELSIUS' },
      }),
    );
    expect(res.event.payload.type).toBe('INVALID_VALUE');
  });
});

describe('SetThermostatMode', () => {
  const setMode = (value: unknown) =>
    directive('Alexa.ThermostatController', 'SetThermostatMode', { thermostatMode: { value } });

  test('HEAT publishes {"mode":"heat"} to api/mode', async () => {
    const res = await handler(setMode('HEAT'));
    expect(publishes()).toEqual([
      {
        topic: 'nakostat/sandbox/api/mode',
        payload: { mode: 'heat', timestamp: NOW.toISOString(), userId: 'user-123' },
      },
    ]);
    expect(res.event.header.name).toBe('Response');
    expect(prop(res, 'Alexa.ThermostatController', 'thermostatMode')).toMatchObject({
      value: 'HEAT',
      timeOfSample: NOW.toISOString(),
    });
  });

  test('OFF publishes {"mode":"off"}', async () => {
    const res = await handler(setMode('OFF'));
    expect(publishes()[0].payload.mode).toBe('off');
    expect(prop(res, 'Alexa.ThermostatController', 'thermostatMode').value).toBe('OFF');
  });

  test.each(['COOL', 'AUTO', 'ECO', 'CUSTOM'])('%s is UNSUPPORTED_THERMOSTAT_MODE', async (m) => {
    const res = await handler(setMode(m));
    expect(res.event.header).toMatchObject({
      namespace: 'Alexa.ThermostatController',
      name: 'ErrorResponse',
    });
    expect(res.event.payload.type).toBe('UNSUPPORTED_THERMOSTAT_MODE');
    expect(publishes()).toHaveLength(0);
  });
});

describe('unknown directives and endpoints', () => {
  test('unknown namespace gives INVALID_DIRECTIVE', async () => {
    const res = await handler(directive('Alexa.PowerController', 'TurnOn'));
    expect(res.event.header.name).toBe('ErrorResponse');
    expect(res.event.payload.type).toBe('INVALID_DIRECTIVE');
  });

  test('unknown thermostat directive gives INVALID_DIRECTIVE', async () => {
    const res = await handler(directive('Alexa.ThermostatController', 'ResumeSchedule'));
    expect(res.event.payload.type).toBe('INVALID_DIRECTIVE');
  });

  test('unknown endpoint gives NO_SUCH_ENDPOINT', async () => {
    const d = directive('Alexa', 'ReportState');
    d.directive.endpoint = { ...endpoint, endpointId: 'kettle' };
    const res = await handler(d);
    expect(res.event.payload.type).toBe('NO_SUCH_ENDPOINT');
  });

  test('a malformed event gives INVALID_DIRECTIVE', async () => {
    const res = await handler({} as never);
    expect(res.event.payload.type).toBe('INVALID_DIRECTIVE');
  });
});

describe('heatlink health', () => {
  const hl = (item: Record<string, unknown> | undefined) =>
    dynamoMock.on(GetCommand, { Key: { deviceId: 'heatlink' } }).resolves({ Item: item });
  const setpoint21 = () =>
    directive('Alexa.ThermostatController', 'SetTargetTemperature', {
      targetSetpoint: { value: 21, scale: 'CELSIUS' },
    });

  test('a heatlink seen 4 minutes ago is UNREACHABLE', async () => {
    hl({ deviceId: 'heatlink', seen: HL_STALE });
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(res.event.header.name).toBe('StateReport');
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({
      value: 'UNREACHABLE',
    });
  });

  test('a missing heatlink item is UNREACHABLE', async () => {
    hl(undefined);
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({
      value: 'UNREACHABLE',
    });
  });

  test('a fresh Pi and heatlink are OK', async () => {
    const res = await handler(directive('Alexa', 'ReportState'));
    expect(prop(res, 'Alexa.EndpointHealth', 'connectivity').value).toEqual({ value: 'OK' });
  });

  test.each([
    ['stale heatlink', () => hl({ deviceId: 'heatlink', seen: HL_STALE })],
    ['missing heatlink', () => hl(undefined)],
    [
      'stale Pi',
      () =>
        dynamoMock
          .on(GetCommand, { Key: { deviceId: 'pi' } })
          .resolves({ Item: piState({ timestamp: STALE }) }),
    ],
  ])('directives return ENDPOINT_UNREACHABLE without publishing (%s)', async (_l, arrange) => {
    arrange();
    for (const d of [
      setpoint21(),
      directive('Alexa.ThermostatController', 'AdjustTargetTemperature', {
        targetSetpointDelta: { value: 1, scale: 'CELSIUS' },
      }),
      directive('Alexa.ThermostatController', 'SetThermostatMode', {
        thermostatMode: { value: 'OFF' },
      }),
    ]) {
      const res = await handler(d);
      expect(res.event.header.name).toBe('ErrorResponse');
      expect(res.event.payload.type).toBe('ENDPOINT_UNREACHABLE');
    }
    expect(publishes()).toHaveLength(0);
  });
});

describe('Celsius rounding', () => {
  test('rounds Celsius values to the nearest 0.5', async () => {
    await handler(
      directive('Alexa.ThermostatController', 'SetTargetTemperature', {
        targetSetpoint: { value: 20.3, scale: 'CELSIUS' },
      }),
    );
    expect(publishes()[0].payload.temperature).toBe(20.5);
  });
});
