import * as cdk from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import * as path from 'path';
import { HEATLINK_THING_NAME } from './iot-stack';

export interface IotRulesStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  readingsTable: dynamodb.ITable;
  stateTable: dynamodb.ITable;
  boilerUsageTable: dynamodb.ITable;
}

export class IotRulesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IotRulesStackProps) {
    super(scope, id, props);

    const { deployEnv, readingsTable, stateTable, boilerUsageTable } = props;
    const heatlinkStatus = `nakostat/${HEATLINK_THING_NAME}/status`;

    /** A rule handler that IoT may invoke. */
    const ruleHandler = (id: string, entry: string, environment: Record<string, string>) => {
      const fn = new nodejs.NodejsFunction(this, id, {
        entry: path.join(__dirname, `../lambda/iot-rules/${entry}`),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        environment,
        bundling: { externalModules: [] },
      });
      fn.addPermission(`IoTInvoke${id}`, {
        principal: new iam.ServicePrincipal('iot.amazonaws.com'),
        sourceAccount: this.account,
      });
      return fn;
    };

    const rule = (id: string, ruleName: string, sql: string, fn: lambda.IFunction) =>
      new iot.CfnTopicRule(this, id, {
        ruleName: `nakostat_${ruleName}_${deployEnv}`,
        topicRulePayload: {
          sql,
          actions: [{ lambda: { functionArn: fn.functionArn } }],
          ruleDisabled: false,
          awsIotSqlVersion: '2016-03-23',
        },
      });

    // ── Sensor readings → readings table ─────────────────────────────────────
    const piReadingsHandler = ruleHandler('PiReadingsHandler', 'pi-readings-handler.ts', {
      READINGS_TABLE_NAME: readingsTable.tableName,
    });
    readingsTable.grantWriteData(piReadingsHandler);
    rule(
      'PiReadingsRule',
      'pi_readings',
      `SELECT * FROM 'nakostat/${deployEnv}/pi/readings'`,
      piReadingsHandler,
    );

    // ── Latest state per device → state table ────────────────────────────────
    // One handler; each rule names the item it writes with a literal deviceId.
    const deviceStateHandler = ruleHandler('DeviceStateHandler', 'device-state-handler.ts', {
      STATE_TABLE_NAME: stateTable.tableName,
    });
    stateTable.grantWriteData(deviceStateHandler);
    rule(
      'HeatlinkStateRule',
      'heatlink_state',
      `SELECT *, 'heatlink' AS deviceId FROM '${heatlinkStatus}'`,
      deviceStateHandler,
    );
    rule(
      'PiStateRule',
      'pi_state',
      `SELECT *, 'pi' AS deviceId FROM 'nakostat/${deployEnv}/pi/state'`,
      deviceStateHandler,
    );
    rule(
      'PiScheduleRule',
      'pi_schedule',
      `SELECT *, 'schedule' AS deviceId FROM 'nakostat/${deployEnv}/pi/schedule'`,
      deviceStateHandler,
    );

    // ── Boiler on/off history → boiler-usage table ───────────────────────────
    const boilerEventHandler = ruleHandler('BoilerEventHandler', 'boiler-event-handler.ts', {
      BOILER_USAGE_TABLE_NAME: boilerUsageTable.tableName,
    });
    boilerUsageTable.grantWriteData(boilerEventHandler);
    rule(
      'HeatlinkBoilerUsageRule',
      'heatlink_boiler_usage',
      `SELECT relay, source FROM '${heatlinkStatus}' WHERE reason = 'change'`,
      boilerEventHandler,
    );
  }
}
