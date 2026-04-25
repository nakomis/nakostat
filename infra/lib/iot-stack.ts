import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Construct } from 'constructs';
import { CertCreator } from './cert-creator';

export interface IotStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

export class IotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IotStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;

    // IoT Things
    const piThing = new iot.CfnThing(this, 'PiThing', {
      thingName: `nakostat-pi-${deployEnv}`,
    });

    const esp32Thing = new iot.CfnThing(this, 'Esp32Thing', {
      thingName: `nakostat-esp32-${deployEnv}`,
    });

    // IoT policies
    const piPolicy = new iot.CfnPolicy(this, 'PiPolicy', {
      policyName: `nakostat-pi-policy-${deployEnv}`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${this.region}:${this.account}:client/nakostat-pi-${deployEnv}`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Publish', 'iot:Receive'],
            Resource: `arn:aws:iot:${this.region}:${this.account}:topic/nakostat/${deployEnv}/pi/*`,
          },
        ],
      },
    });

    const esp32Policy = new iot.CfnPolicy(this, 'Esp32Policy', {
      policyName: `nakostat-esp32-policy-${deployEnv}`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${this.region}:${this.account}:client/nakostat-esp32-${deployEnv}`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Publish', 'iot:Receive'],
            Resource: `arn:aws:iot:${this.region}:${this.account}:topic/nakostat/${deployEnv}/esp32/status`,
          },
          {
            Effect: 'Allow',
            Action: ['iot:Subscribe', 'iot:Receive'],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/nakostat/${deployEnv}/esp32/command`,
              `arn:aws:iot:${this.region}:${this.account}:topic/nakostat/${deployEnv}/esp32/command`,
            ],
          },
        ],
      },
    });

    // Certificates (Lambda-backed custom resources)
    const piCert = new CertCreator(this, 'PiCert', {
      thingName: piThing.thingName!,
      policyName: piPolicy.policyName!,
      certPemPath: `/nakostat/${deployEnv}/pi/certPem`,
      privKeyPath: `/nakostat/${deployEnv}/pi/privKey`,
    });
    piCert.node.addDependency(piThing);
    piCert.node.addDependency(piPolicy);

    const esp32Cert = new CertCreator(this, 'Esp32Cert', {
      thingName: esp32Thing.thingName!,
      policyName: esp32Policy.policyName!,
      certPemPath: `/nakostat/${deployEnv}/esp32/certPem`,
      privKeyPath: `/nakostat/${deployEnv}/esp32/privKey`,
    });
    esp32Cert.node.addDependency(esp32Thing);
    esp32Cert.node.addDependency(esp32Policy);

    // Outputs
    new cdk.CfnOutput(this, 'PiThingName', {
      value: piThing.thingName!,
      description: 'IoT Thing name for the Raspberry Pi',
    });

    new cdk.CfnOutput(this, 'Esp32ThingName', {
      value: esp32Thing.thingName!,
      description: 'IoT Thing name for the ESP32',
    });
  }
}
