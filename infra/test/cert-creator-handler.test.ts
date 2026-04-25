import { mockClient } from 'aws-sdk-client-mock';
import {
  IoTClient,
  CreateKeysAndCertificateCommand,
  AttachThingPrincipalCommand,
  DetachThingPrincipalCommand,
  UpdateCertificateCommand,
  DeleteCertificateCommand,
  AttachPolicyCommand,
  DetachPolicyCommand,
  ListCertificatesCommand,
} from '@aws-sdk/client-iot';
import {
  SSMClient,
  PutParameterCommand,
  DeleteParameterCommand,
} from '@aws-sdk/client-ssm';

// Must import after mock setup
import { iotClient, ssmClient, handler, onCreate, onDelete, getCertArn } from '../lambda/cert-creator/index';

const iotMock = mockClient(iotClient);
const ssmMock = mockClient(ssmClient);

const props = {
  thingName: 'nakostat-pi-sandbox',
  policyName: 'nakostat-pi-policy-sandbox',
  certPemPath: '/nakostat/sandbox/pi/certPem',
  privKeyPath: '/nakostat/sandbox/pi/privKey',
};

beforeEach(() => {
  iotMock.reset();
  ssmMock.reset();
});

describe('onCreate', () => {
  test('creates certificate, stores in SSM, attaches to thing and policy', async () => {
    iotMock
      .on(CreateKeysAndCertificateCommand)
      .resolves({
        certificateId: 'cert-id-123',
        certificateArn: 'arn:aws:iot:eu-west-2:123:cert/cert-id-123',
        certificatePem: '-----BEGIN CERTIFICATE-----\nPEM\n-----END CERTIFICATE-----',
        keyPair: { PrivateKey: '-----BEGIN RSA PRIVATE KEY-----\nKEY\n-----END RSA PRIVATE KEY-----' },
      });
    iotMock.on(AttachPolicyCommand).resolves({});
    iotMock.on(AttachThingPrincipalCommand).resolves({});
    ssmMock.on(PutParameterCommand).resolves({});

    const result = await onCreate(props);

    expect(result.PhysicalResourceId).toBe('cert-id-123');
    expect(iotMock.commandCalls(CreateKeysAndCertificateCommand)).toHaveLength(1);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(2);
    expect(iotMock.commandCalls(AttachPolicyCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(AttachThingPrincipalCommand)).toHaveLength(1);
  });
});

describe('onDelete', () => {
  test('detaches, deactivates, and deletes cert; deletes SSM params', async () => {
    iotMock.on(ListCertificatesCommand).resolves({
      certificates: [{ certificateId: 'cert-id-123', certificateArn: 'arn:aws:iot:eu-west-2:123:cert/cert-id-123' }],
    });
    iotMock.on(DetachThingPrincipalCommand).resolves({});
    iotMock.on(DetachPolicyCommand).resolves({});
    iotMock.on(UpdateCertificateCommand).resolves({});
    iotMock.on(DeleteCertificateCommand).resolves({});
    ssmMock.on(DeleteParameterCommand).resolves({});

    const result = await onDelete('cert-id-123', props);

    expect(result.PhysicalResourceId).toBe('cert-id-123');
    expect(iotMock.commandCalls(DetachThingPrincipalCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(DetachPolicyCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(UpdateCertificateCommand)).toHaveLength(1);
    expect(iotMock.commandCalls(DeleteCertificateCommand)).toHaveLength(1);
    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(2);
  });

  test('skips cert deletion if cert not found in ListCertificates', async () => {
    iotMock.on(ListCertificatesCommand).resolves({ certificates: [] });
    ssmMock.on(DeleteParameterCommand).resolves({});

    await onDelete('missing-cert', props);

    expect(iotMock.commandCalls(DeleteCertificateCommand)).toHaveLength(0);
    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(2);
  });
});

describe('handler dispatch', () => {
  test('Create request calls onCreate', async () => {
    iotMock.on(CreateKeysAndCertificateCommand).resolves({
      certificateId: 'cert-abc',
      certificateArn: 'arn:...',
      certificatePem: 'PEM',
      keyPair: { PrivateKey: 'KEY' },
    });
    iotMock.on(AttachPolicyCommand).resolves({});
    iotMock.on(AttachThingPrincipalCommand).resolves({});
    ssmMock.on(PutParameterCommand).resolves({});

    const result = await handler({ RequestType: 'Create', ResourceProperties: props as unknown as Record<string, unknown> });
    expect(result.PhysicalResourceId).toBe('cert-abc');
  });

  test('Update request is a no-op and preserves PhysicalResourceId', async () => {
    const result = await handler({
      RequestType: 'Update',
      PhysicalResourceId: 'existing-cert-id',
      ResourceProperties: props as unknown as Record<string, unknown>,
    });
    expect(result.PhysicalResourceId).toBe('existing-cert-id');
    expect(iotMock.commandCalls(CreateKeysAndCertificateCommand)).toHaveLength(0);
  });

  test('Delete request calls onDelete', async () => {
    iotMock.on(ListCertificatesCommand).resolves({ certificates: [] });
    ssmMock.on(DeleteParameterCommand).resolves({});

    const result = await handler({
      RequestType: 'Delete',
      PhysicalResourceId: 'cert-to-delete',
      ResourceProperties: props as unknown as Record<string, unknown>,
    });
    expect(result.PhysicalResourceId).toBe('cert-to-delete');
  });
});

describe('getCertArn', () => {
  test('returns ARN when cert exists', async () => {
    iotMock.on(ListCertificatesCommand).resolves({
      certificates: [{ certificateId: 'abc', certificateArn: 'arn:aws:iot:eu-west-2:123:cert/abc' }],
    });
    const arn = await getCertArn('abc');
    expect(arn).toBe('arn:aws:iot:eu-west-2:123:cert/abc');
  });

  test('returns undefined when cert not found', async () => {
    iotMock.on(ListCertificatesCommand).resolves({ certificates: [] });
    const arn = await getCertArn('not-there');
    expect(arn).toBeUndefined();
  });
});
