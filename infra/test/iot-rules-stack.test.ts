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
    boilerUsageTable: dynamoStack.boilerUsageTable,
  });
  return Template.fromStack(stack);
}

/** The logical id of the Lambda function a rule invokes. */
function ruleTarget(template: Template, ruleName: string): string {
  const rules = template.findResources('AWS::IoT::TopicRule', {
    Properties: { RuleName: ruleName },
  });
  const [rule] = Object.values(rules);
  if (!rule) throw new Error(`no rule ${ruleName}`);
  return rule.Properties.TopicRulePayload.Actions[0].Lambda.FunctionArn['Fn::GetAtt'][0];
}

describe('IotRulesStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('sandbox');
  });

  test('creates five IoT topic rules', () => {
    template.resourceCountIs('AWS::IoT::TopicRule', 5);
  });

  test('Pi readings rule targets pi/readings topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_pi_readings_sandbox',
      TopicRulePayload: {
        Sql: "SELECT * FROM 'nakostat/sandbox/pi/readings'",
        RuleDisabled: false,
      },
    });
  });

  test('heatlink status → state table as deviceId "heatlink"', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_heatlink_state_sandbox',
      TopicRulePayload: {
        Sql: "SELECT *, 'heatlink' AS deviceId FROM 'nakostat/nakostat-heatlink/status'",
        RuleDisabled: false,
      },
    });
  });

  test('pi/state → state table as deviceId "pi"', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_pi_state_sandbox',
      TopicRulePayload: {
        Sql: "SELECT *, 'pi' AS deviceId FROM 'nakostat/sandbox/pi/state'",
      },
    });
  });

  test('pi/schedule → state table as deviceId "schedule"', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_pi_schedule_sandbox',
      TopicRulePayload: {
        Sql: "SELECT *, 'schedule' AS deviceId FROM 'nakostat/sandbox/pi/schedule'",
      },
    });
  });

  test('the three state rules share one state-writer Lambda', () => {
    const targets = new Set(
      ['heatlink_state', 'pi_state', 'pi_schedule'].map((r) =>
        ruleTarget(template, `nakostat_${r}_sandbox`),
      ),
    );
    expect(targets.size).toBe(1);
  });

  test('heatlink status changes → boiler-usage Lambda', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_heatlink_boiler_usage_sandbox',
      TopicRulePayload: {
        Sql: "SELECT relay, source FROM 'nakostat/nakostat-heatlink/status' WHERE reason = 'change'",
        RuleDisabled: false,
      },
    });
    const boilerTarget = ruleTarget(template, 'nakostat_heatlink_boiler_usage_sandbox');
    expect(boilerTarget).not.toBe(ruleTarget(template, 'nakostat_heatlink_state_sandbox'));
  });

  test('no ESP32 or Pish-setpoint rule remains', () => {
    const rules = Object.values(template.findResources('AWS::IoT::TopicRule'));
    const sql = rules.map((r) => r.Properties.TopicRulePayload.Sql as string);
    expect(sql.filter((s) => s.includes('esp32') || s.includes('pish/setpoint'))).toEqual([]);
  });

  test('state writer gets the state table, boiler handler the boiler-usage table', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { STATE_TABLE_NAME: Match.anyValue() } },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { BOILER_USAGE_TABLE_NAME: Match.anyValue() } },
    });
  });

  test('creates three Lambda functions for rule handlers', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
  });

  test('IoT may invoke each rule handler', () => {
    template.resourceCountIs('AWS::Lambda::Permission', 3);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'iot.amazonaws.com',
      SourceAccount: '123456789012',
    });
  });

  test('Lambda functions use NODEJS_22_X runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
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
        Sql: Match.stringLikeRegexp('nakostat/prod/pi/readings'),
      },
    });
  });

  test('pi/state and pi/schedule rules target prod topics', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_pi_state_prod',
      TopicRulePayload: { Sql: Match.stringLikeRegexp("'nakostat/prod/pi/state'") },
    });
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_pi_schedule_prod',
      TopicRulePayload: { Sql: Match.stringLikeRegexp("'nakostat/prod/pi/schedule'") },
    });
  });

  test('heatlink rules use the env-less Fleet topic', () => {
    template.hasResourceProperties('AWS::IoT::TopicRule', {
      RuleName: 'nakostat_heatlink_state_prod',
      TopicRulePayload: { Sql: Match.stringLikeRegexp("'nakostat/nakostat-heatlink/status'") },
    });
  });
});
