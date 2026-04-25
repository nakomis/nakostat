import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DynamoStack } from '../lib/dynamo-stack';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const stack = new DynamoStack(app, 'TestDynamoStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
  });
  return { stack, template: Template.fromStack(stack) };
}

describe('DynamoStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = makeStack('sandbox'));
  });

  test('creates readings table with correct name', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-readings-sandbox',
    });
  });

  test('readings table has locationId partition key and timestamp sort key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-readings-sandbox',
      KeySchema: [
        { AttributeName: 'locationId', KeyType: 'HASH' },
        { AttributeName: 'timestamp', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'locationId', AttributeType: 'S' },
        { AttributeName: 'timestamp', AttributeType: 'S' },
      ],
    });
  });

  test('readings table has TTL enabled on ttl attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-readings-sandbox',
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    });
  });

  test('readings table uses on-demand billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-readings-sandbox',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('readings table has point-in-time recovery enabled', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-readings-sandbox',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('creates state table with correct name', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-state-sandbox',
    });
  });

  test('state table has deviceId partition key and no sort key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-state-sandbox',
      KeySchema: [
        { AttributeName: 'deviceId', KeyType: 'HASH' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'deviceId', AttributeType: 'S' },
      ],
    });
  });

  test('state table uses on-demand billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-state-sandbox',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('state table has point-in-time recovery enabled', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-state-sandbox',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('state table has no TTL attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'nakostat-state-sandbox',
    });
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'nakostat-state-sandbox' },
    });
    const stateTable = Object.values(tables)[0] as { Properties: Record<string, unknown> };
    expect(stateTable.Properties['TimeToLiveSpecification']).toBeUndefined();
  });

  test('sandbox tables use DESTROY removal policy', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables) as { UpdateReplacePolicy?: string; DeletionPolicy?: string }[]) {
      expect(table.UpdateReplacePolicy).toBe('Delete');
      expect(table.DeletionPolicy).toBe('Delete');
    }
  });

  test('outputs readings and state table names', () => {
    template.hasOutput('ReadingsTableName', {
      Description: 'DynamoDB table for sensor readings time-series',
      Value: Match.anyValue(),
    });
    template.hasOutput('StateTableName', {
      Description: 'DynamoDB table for current device state',
      Value: Match.anyValue(),
    });
  });
});

describe('DynamoStack — prod', () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = makeStack('prod'));
  });

  test('uses prod suffix in table names', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'nakostat-readings-prod' });
    template.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'nakostat-state-prod' });
  });

  test('prod tables use RETAIN removal policy', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables) as { UpdateReplacePolicy?: string; DeletionPolicy?: string }[]) {
      expect(table.UpdateReplacePolicy).toBe('Retain');
      expect(table.DeletionPolicy).toBe('Retain');
    }
  });
});
