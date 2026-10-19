import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';
import { DynamoStack } from '../lib/dynamo-stack';

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

  test('creates six Lambda functions for API handlers', () => {
    template.resourceCountIs('AWS::Lambda::Function', 6);
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

  test('creates protected POST /mode and PUT /schedule routes', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /mode',
      AuthorizationType: 'JWT',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /schedule',
      AuthorizationType: 'JWT',
    });
  });

  test('CORS allows GET, POST, PUT and OPTIONS', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowMethods: Match.arrayWith(['GET', 'POST', 'PUT', 'OPTIONS']),
      },
    });
  });

  test.each([
    'setpoint',
    'mode',
    'schedule',
  ])('the %s handler may publish only to its api topic', (name) => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Publish',
            Resource: `arn:aws:iot:eu-west-2:123456789012:topic/nakostat/sandbox/api/${name}`,
          },
        ],
      },
    });
  });

  test('control handlers get DEPLOY_ENV and no table (the daemon is the authority)', () => {
    const fns = Object.values(
      template.findResources('AWS::Lambda::Function', {
        Properties: { Environment: { Variables: { DEPLOY_ENV: 'sandbox' } } },
      }),
    );
    expect(fns).toHaveLength(3);
    for (const fn of fns) {
      expect(Object.keys(fn.Properties.Environment.Variables)).toEqual(['DEPLOY_ENV']);
    }
  });

  test('GET /state handler may only read the state table', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['dynamodb:GetItem']) }),
        ]),
      },
    });
    const writers = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes('dynamodb:PutItem'),
    );
    expect(writers).toEqual([]);
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
