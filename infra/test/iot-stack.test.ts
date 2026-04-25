import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { IotStack } from '../lib/iot-stack';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const stack = new IotStack(app, 'TestIotStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
  });
  return Template.fromStack(stack);
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

  test('creates ESP32 IoT Thing', () => {
    template.hasResourceProperties('AWS::IoT::Thing', {
      ThingName: 'nakostat-esp32-sandbox',
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
            Resource: Match.stringLikeRegexp('nakostat-pi-sandbox'),
          }),
        ]),
      },
    });
  });

  test('Pi policy allows publish to pi/* topics', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-pi-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['iot:Publish']),
            Resource: Match.stringLikeRegexp('/pi/\\*'),
          }),
        ]),
      },
    });
  });

  test('ESP32 policy allows connect as nakostat-esp32-sandbox', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-esp32-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: Match.stringLikeRegexp('nakostat-esp32-sandbox'),
          }),
        ]),
      },
    });
  });

  test('ESP32 policy allows publish to esp32/status topic', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-esp32-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['iot:Publish']),
            Resource: Match.stringLikeRegexp('/esp32/status'),
          }),
        ]),
      },
    });
  });

  test('ESP32 policy allows subscribe to esp32/command topic', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'nakostat-esp32-policy-sandbox',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['iot:Subscribe']),
          }),
        ]),
      },
    });
  });

  test('two custom resources created (one per device)', () => {
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
            Resource: Match.arrayWith([
              Match.stringLikeRegexp('/nakostat/sandbox/pi/certPem'),
            ]),
          }),
        ]),
      },
    });
  });

  test('CfnOutputs include Thing names', () => {
    template.hasOutput('PiThingName', {
      Value: 'nakostat-pi-sandbox',
    });
    template.hasOutput('Esp32ThingName', {
      Value: 'nakostat-esp32-sandbox',
    });
  });
});

describe('IotStack — prod', () => {
  test('uses prod suffix in Thing and policy names', () => {
    const template = makeStack('prod');
    template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nakostat-pi-prod' });
    template.hasResourceProperties('AWS::IoT::Thing', { ThingName: 'nakostat-esp32-prod' });
    template.hasResourceProperties('AWS::IoT::Policy', { PolicyName: 'nakostat-pi-policy-prod' });
    template.hasResourceProperties('AWS::IoT::Policy', { PolicyName: 'nakostat-esp32-policy-prod' });
  });
});
