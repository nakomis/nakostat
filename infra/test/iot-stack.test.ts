import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { IotStack } from '../lib/iot-stack';

const ARN = 'arn:aws:iot:eu-west-2:123456789012';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const stack = new IotStack(app, 'TestIotStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
  });
  return Template.fromStack(stack);
}

/** The policy document of the IoT policy with this name. */
function policyStatements(template: Template, policyName: string): Record<string, unknown>[] {
  const policies = template.findResources('AWS::IoT::Policy', {
    Properties: { PolicyName: policyName },
  });
  const [policy] = Object.values(policies);
  if (!policy) throw new Error(`no policy ${policyName}`);
  return policy.Properties.PolicyDocument.Statement;
}

/** Every resource a policy grants for one action, flattened. */
function resourcesFor(statements: Record<string, unknown>[], action: string): string[] {
  return statements
    .filter((s) => ([] as unknown[]).concat(s.Action).includes(action))
    .flatMap((s) => ([] as string[]).concat(s.Resource as string | string[]));
}

describe('IotStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('sandbox');
  });

  test('creates Pi IoT Thing', () => {
    template.hasResourceProperties('AWS::IoT::Thing', {
      ThingName: 'nakostat-pi-sandbox',
    });
  });

  test('Pi policy allows connect as nakostat-pi-sandbox', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-pi-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `${ARN}:client/nakostat-pi-sandbox`,
          }),
        ]),
      },
    });
  });

  describe('Pi policy (the daemon is the brain)', () => {
    let statements: Record<string, unknown>[];

    beforeAll(() => {
      statements = policyStatements(template, 'nakostat-pi-policy-sandbox');
    });

    test('publishes its own pi/* topics and the heatlink commands topic only', () => {
      expect(resourcesFor(statements, 'iot:Publish').sort()).toEqual(
        [
          `${ARN}:topic/nakostat/sandbox/pi/*`,
          `${ARN}:topic/nakostat/nakostat-heatlink/commands`,
        ].sort(),
      );
    });

    const inbound = [
      'nakostat/sandbox/api/*',
      'nakostat/sandbox/pish/setpoint',
      'nakostat/nakostat-heatlink/status',
      'nakostat/nakostat-heatlink/responses',
    ];

    test('subscribes (topicfilter) to api/*, pish/setpoint and heatlink status/responses', () => {
      expect(resourcesFor(statements, 'iot:Subscribe').sort()).toEqual(
        inbound.map((t) => `${ARN}:topicfilter/${t}`).sort(),
      );
    });

    test('receives (topic) on the same topics', () => {
      expect(resourcesFor(statements, 'iot:Receive').sort()).toEqual(
        inbound.map((t) => `${ARN}:topic/${t}`).sort(),
      );
    });

    test('may not publish heatlink status (only the heatlink may)', () => {
      expect(resourcesFor(statements, 'iot:Publish')).not.toContain(
        `${ARN}:topic/nakostat/nakostat-heatlink/status`,
      );
    });
  });

  describe('heatlink (Fleet device)', () => {
    test('Thing has no env suffix and carries Fleet attributes', () => {
      template.hasResourceProperties('AWS::IoT::Thing', {
        ThingName: 'nakostat-heatlink',
        AttributePayload: {
          Attributes: { project: 'nakostat', deviceType: 'heatlink', capabilities: 'ota' },
        },
      });
    });

    test('policy is Fleet-shaped: connect as its own attached Thing only', () => {
      template.hasResourceProperties('AWS::IoT::Policy', {
        PolicyName: 'nakostat-heatlink-policy-sandbox',
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: 'Allow',
              Action: 'iot:Connect',
              Resource: `${ARN}:client/\${iot:Connection.Thing.ThingName}`,
              Condition: { Bool: { 'iot:Connection.Thing.IsAttached': 'true' } },
            },
          ]),
        },
      });
    });

    test('policy publishes own responses and status, takes own commands', () => {
      const statements = policyStatements(template, 'nakostat-heatlink-policy-sandbox');
      const own = (suffix: string) => `nakostat/\${iot:Connection.Thing.ThingName}/${suffix}`;
      expect(resourcesFor(statements, 'iot:Publish').sort()).toEqual(
        [`${ARN}:topic/${own('responses')}`, `${ARN}:topic/${own('status')}`].sort(),
      );
      expect(resourcesFor(statements, 'iot:Subscribe')).toEqual([
        `${ARN}:topicfilter/${own('commands')}`,
      ]);
      expect(resourcesFor(statements, 'iot:Receive')).toEqual([`${ARN}:topic/${own('commands')}`]);
    });

    test('has no CloudFormation-made certificate', () => {
      const certs = template.findResources('AWS::CloudFormation::CustomResource', {
        Properties: { thingName: 'nakostat-heatlink' },
      });
      expect(Object.keys(certs)).toHaveLength(0);
    });

    test('outputs the Thing and policy names', () => {
      template.hasOutput('HeatlinkThingName', { Value: 'nakostat-heatlink' });
      template.hasOutput('HeatlinkPolicyName', { Value: 'nakostat-heatlink-policy-sandbox' });
    });
  });

  test('the old ESP32 Thing, policy and output are gone', () => {
    const things = template.findResources('AWS::IoT::Thing');
    const policies = template.findResources('AWS::IoT::Policy');
    const names = [
      ...Object.values(things).map((r) => r.Properties.ThingName),
      ...Object.values(policies).map((r) => r.Properties.PolicyName),
    ];
    expect(names.filter((n) => String(n).includes('esp32'))).toEqual([]);
    expect(Object.keys(template.findOutputs('Esp32ThingName'))).toHaveLength(0);
  });

  test('creates Pish display IoT Thing', () => {
    template.hasResourceProperties('AWS::IoT::Thing', {
      ThingName: 'nakostat-pish-sandbox',
    });
  });

  test('Pish policy allows connect only as nakostat-pish-sandbox', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-pish-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: Match.stringLikeRegexp(':client/nakostat-pish-sandbox$'),
          }),
        ]),
      },
    });
  });

  test('Pish policy allows publish only to pish/setpoint', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-pish-policy-sandbox',
      PolicyDocument: {
        Statement: [
          Match.objectLike({ Action: 'iot:Connect' }),
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: Match.stringLikeRegexp(':topic/nakostat/sandbox/pish/setpoint$'),
          },
        ],
      },
    });
  });

  test('Pish cert is stored under the pish SSM paths', () => {
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      thingName: 'nakostat-pish-sandbox',
      policyName: 'nakostat-pish-policy-sandbox',
      certPemPath: '/nakostat/sandbox/pish/certPem',
      privKeyPath: '/nakostat/sandbox/pish/privKey',
    });
  });

  test('two custom resources created (Pi and Pish; the heatlink provisions its own)', () => {
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 2);
  });

  test('Lambda has IoT permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'iot:CreateKeysAndCertificate',
              'iot:AttachThingPrincipal',
              'iot:DetachThingPrincipal',
            ]),
          }),
        ]),
      },
    });
  });

  test('Lambda has SSM PutParameter permission scoped to pi paths', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ssm:PutParameter', 'ssm:DeleteParameter']),
            Resource: Match.arrayWith([Match.stringLikeRegexp('/nakostat/sandbox/pi/certPem')]),
          }),
        ]),
      },
    });
  });

  test('CfnOutputs include Thing names', () => {
    template.hasOutput('PiThingName', {
      Value: 'nakostat-pi-sandbox',
    });
    template.hasOutput('PishThingName', {
      Value: 'nakostat-pish-sandbox',
    });
  });
});

describe('IotStack — prod', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('prod');
  });

  test('uses prod suffix in Thing and policy names', () => {
    template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nakostat-pi-prod' });
    template.hasResourceProperties('AWS::IoT::Policy', { PolicyName: 'nakostat-pi-policy-prod' });
    template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nakostat-pish-prod' });
    template.hasResourceProperties('AWS::IoT::Policy', { PolicyName: 'nakostat-pish-policy-prod' });
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-heatlink-policy-prod',
    });
  });

  test('the heatlink Thing name has no env suffix in prod either', () => {
    template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nakostat-heatlink' });
  });

  test('Pi policy uses prod api/* and the shared heatlink topics', () => {
    const statements = policyStatements(template, 'nakostat-pi-policy-prod');
    expect(resourcesFor(statements, 'iot:Subscribe')).toContain(
      `${ARN}:topicfilter/nakostat/prod/api/*`,
    );
    expect(resourcesFor(statements, 'iot:Publish')).toContain(
      `${ARN}:topic/nakostat/nakostat-heatlink/commands`,
    );
  });
});
