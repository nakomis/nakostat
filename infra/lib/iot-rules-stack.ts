import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface IotRulesStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  readingsTable: dynamodb.ITable;
  stateTable: dynamodb.ITable;
}

export class IotRulesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IotRulesStackProps) {
    super(scope, id, props);

    const { deployEnv, readingsTable, stateTable } = props;

    const piReadingsHandler = new nodejs.NodejsFunction(this, 'PiReadingsHandler', {
      entry: path.join(__dirname, '../lambda/iot-rules/pi-readings-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { READINGS_TABLE_NAME: readingsTable.tableName },
      bundling: { externalModules: [] },
    });
    readingsTable.grantWriteData(piReadingsHandler);

    piReadingsHandler.addPermission('IoTInvokePiReadings', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceAccount: this.account,
    });

    new iot.CfnTopicRule(this, 'PiReadingsRule', {
      ruleName: `nakostat_pi_readings_${deployEnv}`,
      topicRulePayload: {
        sql: `SELECT * FROM 'nakostat/${deployEnv}/pi/readings'`,
        actions: [{ lambda: { functionArn: piReadingsHandler.functionArn } }],
        ruleDisabled: false,
        awsIotSqlVersion: '2016-03-23',
      },
    });

    const esp32StatusHandler = new nodejs.NodejsFunction(this, 'Esp32StatusHandler', {
      entry: path.join(__dirname, '../lambda/iot-rules/esp32-status-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { STATE_TABLE_NAME: stateTable.tableName },
      bundling: { externalModules: [] },
    });
    stateTable.grantWriteData(esp32StatusHandler);

    esp32StatusHandler.addPermission('IoTInvokeEsp32Status', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceAccount: this.account,
    });

    new iot.CfnTopicRule(this, 'Esp32StatusRule', {
      ruleName: `nakostat_esp32_status_${deployEnv}`,
      topicRulePayload: {
        sql: `SELECT * FROM 'nakostat/${deployEnv}/esp32/status'`,
        actions: [{ lambda: { functionArn: esp32StatusHandler.functionArn } }],
        ruleDisabled: false,
        awsIotSqlVersion: '2016-03-23',
      },
    });
  }
}
