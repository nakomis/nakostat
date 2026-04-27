import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DynamoStack } from '../lib/dynamo-stack';
import { IotRulesStack } from '../lib/iot-rules-stack';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'eu-west-2' };
  const dynamoStack = new DynamoStack(app, 'DynamoStack', { env, deployEnv });
  const stack = new IotRulesStack(app, 'IotRulesStack', {
    env,
    deployEnv,
    readingsTable: dynamoStack.readingsTable,
    stateTable: dynamoStack.stateTable,
  });
  return Template.fromStack(stack);
}

describe('IotRulesStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('sandbox');
  });

  test('creates two IoT topic rules', () => {
    template.resourceCountIs('AWS::IoT::TopicRule', 2);
  });

  test('Pi readings rule targets pi/readings topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp('pi/readings'),
      },
    });
  });

  test('ESP32 status rule targets esp32/status topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp('esp32/status'),
      },
    });
  });

  test('creates two Lambda functions for rule handlers', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  test('Lambda functions use NODEJS_22_X runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
    });
  });

  test('Pi rule is not disabled', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp('pi/readings'),
        RuleDisabled: false,
      },
    });
  });
});

describe('IotRulesStack — prod', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('prod');
  });

  test('Pi readings rule targets prod topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp("nakostat/prod/pi/readings"),
      },
    });
  });

  test('ESP32 status rule targets prod topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      TopicRulePayload: {
        Sql: Match.stringLikeRegexp("nakostat/prod/esp32/status"),
      },
    });
  });
});
