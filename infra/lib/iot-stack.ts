import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import type { Construct } from 'constructs';
import { CertCreator } from './cert-creator';

export interface IotStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

/**
 * The heatlink's Thing name. Sandbox and prod are separate accounts, so it has no env suffix, and
 * its topics follow Fleet's `{project}/{thing}/…` shape (see the STAT-69 spec).
 */
export const HEATLINK_THING_NAME = 'nakostat-heatlink';

export class IotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IotStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;
    const arn = (resource: string) => `arn:aws:iot:${this.region}:${this.account}:${resource}`;

    // IoT Things
    const piThing = new iot.CfnThing(this, 'PiThing', {
      thingName: `nakostat-pi-${deployEnv}`,
    });

    // Pish touch display (nakomis/pish) — host `pish`. Separate from the Pi
    // sensor daemon's thing so the two never share an MQTT client id.
    const pishThing = new iot.CfnThing(this, 'PishThing', {
      thingName: `nakostat-pish-${deployEnv}`,
    });

    // The heatlink (ESP32-S3 boiler switch) is a Fleet device. Its attributes tell Fleet which
    // project it belongs to and what it can do: plain, unsigned OTA for the prototype. Its
    // certificate is made and attached by the firmware's provision-device.sh, never here: the
    // private key must not pass through CloudFormation.
    const heatlinkThing = new iot.CfnThing(this, 'HeatlinkThing', {
      thingName: HEATLINK_THING_NAME,
      attributePayload: {
        attributes: { project: 'nakostat', deviceType: 'heatlink', capabilities: 'ota' },
      },
    });

    // IoT policies
    //
    // The Pi daemon is the brain: it hears setpoint, mode and schedule requests (api/*, the Pish
    // dial) and the heatlink's status and replies, and it sends the heatlink its demand.
    const heatlinkTopic = (suffix: string) => `nakostat/${HEATLINK_THING_NAME}/${suffix}`;
    const piInbound = [
      `nakostat/${deployEnv}/api/*`,
      `nakostat/${deployEnv}/pish/setpoint`,
      heatlinkTopic('status'),
      heatlinkTopic('responses'),
    ];
    const piPolicy = new iot.CfnPolicy(this, 'PiPolicy', {
      policyName: `nakostat-pi-policy-${deployEnv}`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: arn(`client/nakostat-pi-${deployEnv}`),
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: [
              arn(`topic/nakostat/${deployEnv}/pi/*`),
              arn(`topic/${heatlinkTopic('commands')}`),
            ],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: piInbound.map((t) => arn(`topicfilter/${t}`)),
          },
          {
            Effect: 'Allow',
            Action: 'iot:Receive',
            Resource: piInbound.map((t) => arn(`topic/${t}`)),
          },
        ],
      },
    });

    // Fleet-shaped (kappa-warmer's device-stack.ts): policy variables pin each certificate to its
    // own Thing. The client id must be the Thing's name, and the certificate must be attached to it.
    const ownTopic = (suffix: string) => `nakostat/\${iot:Connection.Thing.ThingName}/${suffix}`;
    const heatlinkPolicy = new iot.CfnPolicy(this, 'HeatlinkPolicy', {
      policyName: `nakostat-heatlink-policy-${deployEnv}`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: arn('client/${iot:Connection.Thing.ThingName}'),
            Condition: { Bool: { 'iot:Connection.Thing.IsAttached': 'true' } },
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: [arn(`topic/${ownTopic('responses')}`), arn(`topic/${ownTopic('status')}`)],
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: arn(`topicfilter/${ownTopic('commands')}`),
          },
          {
            Effect: 'Allow',
            Action: 'iot:Receive',
            Resource: arn(`topic/${ownTopic('commands')}`),
          },
        ],
      },
    });

    // The display only ever publishes setpoint changes from its dial.
    const pishPolicy = new iot.CfnPolicy(this, 'PishPolicy', {
      policyName: `nakostat-pish-policy-${deployEnv}`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: arn(`client/nakostat-pish-${deployEnv}`),
          },
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: arn(`topic/nakostat/${deployEnv}/pish/setpoint`),
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

    const pishCert = new CertCreator(this, 'PishCert', {
      thingName: pishThing.thingName!,
      policyName: pishPolicy.policyName!,
      certPemPath: `/nakostat/${deployEnv}/pish/certPem`,
      privKeyPath: `/nakostat/${deployEnv}/pish/privKey`,
    });
    pishCert.node.addDependency(pishThing);
    pishCert.node.addDependency(pishPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'PiThingName', {
      value: piThing.thingName!,
      description: 'IoT Thing name for the Raspberry Pi',
    });

    new cdk.CfnOutput(this, 'PishThingName', {
      value: pishThing.thingName!,
      description: 'IoT Thing name for the Pish touch display',
    });

    new cdk.CfnOutput(this, 'HeatlinkThingName', {
      value: heatlinkThing.thingName!,
      description: 'IoT Thing name for the heatlink (Fleet device; cert by provision-device.sh)',
    });

    new cdk.CfnOutput(this, 'HeatlinkPolicyName', {
      value: heatlinkPolicy.policyName!,
      description: 'IoT policy provision-device.sh attaches to the heatlink certificate',
    });
  }
}
