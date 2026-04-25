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
  ParameterType,
} from '@aws-sdk/client-ssm';

export const iotClient = new IoTClient({});
export const ssmClient = new SSMClient({});

export interface ResourceProperties {
  thingName: string;
  policyName: string;
  certPemPath: string;
  privKeyPath: string;
}

interface OnEventRequest {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  ResourceProperties: Record<string, unknown>;
}

interface OnEventResponse {
  PhysicalResourceId?: string;
  Data?: Record<string, unknown>;
}

export async function handler(event: OnEventRequest): Promise<OnEventResponse> {
  const props = event.ResourceProperties as unknown as ResourceProperties;

  switch (event.RequestType) {
    case 'Create':
      return onCreate(props);
    case 'Update':
      return { PhysicalResourceId: event.PhysicalResourceId };
    case 'Delete':
      return onDelete(event.PhysicalResourceId!, props);
  }
}

export async function onCreate(props: ResourceProperties): Promise<OnEventResponse> {
  const cert = await iotClient.send(new CreateKeysAndCertificateCommand({ setAsActive: true }));

  const certId = cert.certificateId!;
  const certArn = cert.certificateArn!;
  const certPem = cert.certificatePem!;
  const privKey = cert.keyPair!.PrivateKey!;

  await Promise.all([
    ssmClient.send(new PutParameterCommand({
      Name: props.certPemPath,
      Value: certPem,
      Type: ParameterType.SECURE_STRING,
      Overwrite: true,
    })),
    ssmClient.send(new PutParameterCommand({
      Name: props.privKeyPath,
      Value: privKey,
      Type: ParameterType.SECURE_STRING,
      Overwrite: true,
    })),
    iotClient.send(new AttachPolicyCommand({
      policyName: props.policyName,
      target: certArn,
    })),
    iotClient.send(new AttachThingPrincipalCommand({
      thingName: props.thingName,
      principal: certArn,
    })),
  ]);

  return { PhysicalResourceId: certId };
}

export async function onDelete(certId: string, props: ResourceProperties): Promise<OnEventResponse> {
  const certArn = await getCertArn(certId);

  if (certArn) {
    await Promise.all([
      iotClient.send(new DetachThingPrincipalCommand({
        thingName: props.thingName,
        principal: certArn,
      })),
      iotClient.send(new DetachPolicyCommand({
        policyName: props.policyName,
        target: certArn,
      })),
    ]);

    await iotClient.send(new UpdateCertificateCommand({
      certificateId: certId,
      newStatus: 'INACTIVE',
    }));

    await iotClient.send(new DeleteCertificateCommand({ certificateId: certId }));
  }

  await Promise.allSettled([
    ssmClient.send(new DeleteParameterCommand({ Name: props.certPemPath })),
    ssmClient.send(new DeleteParameterCommand({ Name: props.privKeyPath })),
  ]);

  return { PhysicalResourceId: certId };
}

export async function getCertArn(certId: string): Promise<string | undefined> {
  const response = await iotClient.send(new ListCertificatesCommand({}));
  return response.certificates?.find(c => c.certificateId === certId)?.certificateArn;
}
