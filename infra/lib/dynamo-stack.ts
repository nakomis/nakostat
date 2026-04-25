import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DynamoStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

export class DynamoStack extends cdk.Stack {
  readonly readingsTable: dynamodb.Table;
  readonly stateTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DynamoStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;

    this.readingsTable = new dynamodb.Table(this, 'ReadingsTable', {
      tableName: `nakostat-readings-${deployEnv}`,
      partitionKey: { name: 'locationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: deployEnv === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    this.stateTable = new dynamodb.Table(this, 'StateTable', {
      tableName: `nakostat-state-${deployEnv}`,
      partitionKey: { name: 'deviceId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: deployEnv === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'ReadingsTableName', {
      value: this.readingsTable.tableName,
      description: 'DynamoDB table for sensor readings time-series',
    });

    new cdk.CfnOutput(this, 'StateTableName', {
      value: this.stateTable.tableName,
      description: 'DynamoDB table for current device state',
    });
  }
}
