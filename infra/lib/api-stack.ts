import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  readingsTable: dynamodb.ITable;
  stateTable: dynamodb.ITable;
  boilerUsageTable: dynamodb.ITable;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { deployEnv, readingsTable, stateTable, boilerUsageTable } = props;
    const isProd = deployEnv === 'prod';
    const appOrigin = isProd
      ? 'https://nakostat.nakomis.com'
      : 'https://nakostat.sandbox.nakomis.com';

    // ── Cognito JWT authoriser ────────────────────────────────────────────────
    // Both IDs are read by SSM *parameter name* — a stable handle that survives
    // the underlying pool/client being recreated (the ID changes, the parameter
    // name doesn't), resolved at deploy time. The shared pool ID comes from
    // nakomis-infra; the nakostat app client ID is published by WebStack — hence
    // the ApiStack → WebStack dependency wired in bin/nakostat.ts.
    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this, `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const userPoolClientId = ssm.StringParameter.valueForStringParameter(
      this, `/nakostat/${deployEnv}/cognito/client-id`,
    );

    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPoolId}`,
      {
        authorizerName: `nakostat-cognito-${deployEnv}`,
        identitySource: ['$request.header.Authorization'],
        jwtAudience: [userPoolClientId],
      },
    );

    // ── Handlers ──────────────────────────────────────────────────────────────
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

    const setpointHandler = new nodejs.NodejsFunction(this, 'SetpointHandler', {
      entry: path.join(__dirname, '../lambda/api/setpoint-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { STATE_TABLE_NAME: stateTable.tableName, DEPLOY_ENV: deployEnv },
      bundling: { externalModules: [] },
    });
    stateTable.grantWriteData(setpointHandler);
    setpointHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:Publish'],
      resources: [
        `arn:aws:iot:${this.region}:${this.account}:topic/nakostat/${deployEnv}/api/setpoint`,
      ],
    }));

    const boilerUsageHandler = new nodejs.NodejsFunction(this, 'BoilerUsageHandler', {
      entry: path.join(__dirname, '../lambda/api/boiler-usage-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { BOILER_USAGE_TABLE_NAME: boilerUsageTable.tableName },
      bundling: { externalModules: [] },
    });
    boilerUsageTable.grantReadData(boilerUsageHandler);

    // ── HTTP API ──────────────────────────────────────────────────────────────
    // The authoriser is the API default, so every route (existing and new) is
    // protected unless a route opts out.
    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: `nakostat-api-${deployEnv}`,
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: [appOrigin, 'http://localhost:3000'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
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

    api.addRoutes({
      path: '/setpoint',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('SetpointIntegration', setpointHandler),
    });

    api.addRoutes({
      path: '/boiler-usage',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('BoilerUsageIntegration', boilerUsageHandler),
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
