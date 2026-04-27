import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  readingsTable: dynamodb.ITable;
  stateTable: dynamodb.ITable;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { deployEnv, readingsTable, stateTable } = props;
    const isProd = deployEnv === 'prod';
    const appOrigin = isProd
      ? 'https://nakostat.nakomis.com'
      : 'https://nakostat.sandbox.nakomis.com';

    const getStateHandler = new nodejs.NodejsFunction(this, 'GetStateHandler', {
      entry: path.join(__dirname, '../lambda/api/get-state-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { STATE_TABLE_NAME: stateTable.tableName },
      bundling: { externalModules: [] },
    });
    stateTable.grantReadData(getStateHandler);

    const getReadingsHandler = new nodejs.NodejsFunction(this, 'GetReadingsHandler', {
      entry: path.join(__dirname, '../lambda/api/get-readings-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { READINGS_TABLE_NAME: readingsTable.tableName },
      bundling: { externalModules: [] },
    });
    readingsTable.grantReadData(getReadingsHandler);

    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: `nakostat-api-${deployEnv}`,
      corsPreflight: {
        allowOrigins: [appOrigin, 'http://localhost:3000'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({
      path: '/state',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetStateIntegration', getStateHandler),
    });

    api.addRoutes({
      path: '/readings',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetReadingsIntegration', getReadingsHandler),
    });

    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/nakostat/${deployEnv}/api/url`,
      stringValue: api.url!,
      description: `Nakostat HTTP API URL (${deployEnv})`,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url!,
      description: 'Nakostat HTTP API Gateway URL',
    });
  }
}
