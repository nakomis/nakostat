import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DynamoStack } from '../lib/dynamo-stack';
import { ApiStack } from '../lib/api-stack';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'eu-west-2' };
  const dynamoStack = new DynamoStack(app, 'DynamoStack', { env, deployEnv });
  const stack = new ApiStack(app, 'ApiStack', {
    env,
    deployEnv,
    readingsTable: dynamoStack.readingsTable,
    stateTable: dynamoStack.stateTable,
    boilerUsageTable: dynamoStack.boilerUsageTable,
  });
  return Template.fromStack(stack);
}

describe('ApiStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('sandbox');
  });

  test('creates an HTTP API', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  });

  test('API is named nakostat-api-sandbox', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'nakostat-api-sandbox',
    });
  });

  test('CORS allows localhost origin', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowOrigins: Match.arrayWith(['http://localhost:3000']),
      },
    });
  });

  test('CORS allows sandbox app origin', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowOrigins: Match.arrayWith(['https://nakostat.sandbox.nakomis.com']),
      },
    });
  });

  test('creates GET /state route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /state',
    });
  });

  test('creates GET /readings route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /readings',
    });
  });

  test('creates four Lambda functions for API handlers', () => {
    template.resourceCountIs('AWS::Lambda::Function', 4);
  });

  test('creates a Cognito JWT authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
  });

  test('GET /state route is protected by the JWT authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /state',
      AuthorizationType: 'JWT',
      AuthorizerId: Match.anyValue(),
    });
  });

  test('GET /readings route is protected by the JWT authorizer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /readings',
      AuthorizationType: 'JWT',
    });
  });

  test('creates protected POST /setpoint route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /setpoint',
      AuthorizationType: 'JWT',
    });
  });

  test('creates protected GET /boiler-usage route', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /boiler-usage',
      AuthorizationType: 'JWT',
    });
  });

  test('CORS allows POST', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowMethods: Match.arrayWith(['POST']),
      },
    });
  });

  test('publishes API URL to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nakostat/sandbox/api/url',
      Type: 'String',
    });
  });

  test('outputs API URL', () => {
    template.hasOutput('ApiUrl', { Description: Match.anyValue() });
  });
});

describe('ApiStack — prod', () => {
  let template: Template;

  beforeAll(() => {
    template = makeStack('prod');
  });

  test('CORS allows prod app origin', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowOrigins: Match.arrayWith(['https://nakostat.nakomis.com']),
      },
    });
  });

  test('publishes API URL to SSM with prod path', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nakostat/prod/api/url',
      Type: 'String',
    });
  });
});
