import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { AlexaAuthStack, AlexaStack, alexaRedirectUris } from '../lib/alexa-stack';

const ACCOUNT = '123456789012';
const SKILL_ID = 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555';

function makeStacks(
  opts: { deployEnv?: 'sandbox' | 'prod'; skillId?: string; vendorId?: string } = {},
) {
  const deployEnv = opts.deployEnv ?? 'sandbox';
  const app = new cdk.App();
  const auth = new AlexaAuthStack(app, 'AlexaAuth', {
    env: { account: ACCOUNT, region: 'eu-west-2' },
    deployEnv,
    vendorId: opts.vendorId,
    crossRegionReferences: true,
  });
  const skill = new AlexaStack(app, 'Alexa', {
    env: { account: ACCOUNT, region: 'eu-west-1' },
    deployEnv,
    userPoolId: auth.userPoolId,
    alexaClientId: auth.client.userPoolClientId,
    skillId: opts.skillId,
    crossRegionReferences: true,
  });
  return { auth, skill, authT: Template.fromStack(auth), skillT: Template.fromStack(skill) };
}

describe('AlexaStack (eu-west-1) with a skill ID', () => {
  let skillT: Template;
  let skill: AlexaStack;

  beforeAll(() => {
    ({ skillT, skill } = makeStacks({ skillId: SKILL_ID }));
  });

  test('is deployed to eu-west-1', () => {
    expect(skill.region).toBe('eu-west-1');
  });

  test('creates a named Node 22 Lambda pointing at the home region', () => {
    skillT.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'nakostat-alexa-sandbox',
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          DEPLOY_ENV: 'sandbox',
          TARGET_REGION: 'eu-west-2',
          STATE_TABLE_NAME: 'nakostat-state-sandbox',
          USER_POOL_ID: Match.anyValue(),
          ALEXA_CLIENT_ID: Match.anyValue(),
        }),
      },
    });
  });

  test('allows only the Alexa Smart Home trigger for this skill', () => {
    skillT.resourceCountIs('AWS::Lambda::Permission', 1);
    skillT.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'alexa-connectedhome.amazon.com',
      EventSourceToken: SKILL_ID,
    });
  });

  test('can read only the pi and heatlink items of the eu-west-2 state table', () => {
    skillT.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:GetItem',
            Resource: `arn:aws:dynamodb:eu-west-2:${ACCOUNT}:table/nakostat-state-sandbox`,
            Condition: {
              'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['pi', 'heatlink'] },
            },
          }),
        ]),
      },
    });
  });

  test('can publish only to api/setpoint and api/mode in eu-west-2', () => {
    skillT.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'iot:Publish',
            Resource: [
              `arn:aws:iot:eu-west-2:${ACCOUNT}:topic/nakostat/sandbox/api/setpoint`,
              `arn:aws:iot:eu-west-2:${ACCOUNT}:topic/nakostat/sandbox/api/mode`,
            ],
          }),
        ]),
      },
    });
  });

  test('outputs the function ARN for the skill endpoint', () => {
    skillT.hasOutput('AlexaFunctionArn', {});
  });

  test('rejects a malformed skill ID', () => {
    expect(() => makeStacks({ skillId: 'not-a-skill' })).toThrow(/amzn1\.ask\.skill/);
  });
});

describe('AlexaStack before the skill exists', () => {
  test('synthesises with no trigger and a warning', () => {
    const { skill, skillT } = makeStacks();
    skillT.resourceCountIs('AWS::Lambda::Permission', 0);
    Annotations.fromStack(skill).hasWarning('*', Match.stringLikeRegexp('alexa/skillId'));
  });
});

describe('AlexaAuthStack (eu-west-2)', () => {
  let authT: Template;
  let auth: AlexaAuthStack;

  beforeAll(() => {
    ({ authT, auth } = makeStacks({ vendorId: 'M2ABCDEFGHIJ' }));
  });

  test('is deployed to the pool region', () => {
    expect(auth.region).toBe('eu-west-2');
  });

  test('creates an authorisation-code client with a secret on the shared pool', () => {
    authT.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nakostat-alexa-sandbox',
      GenerateSecret: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayEquals(['openid', 'profile', 'email']),
      UserPoolId: { Ref: Match.stringLikeRegexp('nakomisinfrasandboxcognitouserpoolid') },
    });
  });

  test('redirects to the Alexa account-linking URLs for the vendor', () => {
    authT.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: alexaRedirectUris('M2ABCDEFGHIJ'),
    });
    expect(alexaRedirectUris('V')).toEqual([
      'https://layla.amazon.com/api/skill/link/V',
      'https://pitangui.amazon.com/api/skill/link/V',
      'https://alexa.amazon.co.jp/api/skill/link/V',
    ]);
  });

  test('keeps the refresh token for 10 years so the link does not lapse', () => {
    authT.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      RefreshTokenValidity: 3650 * 24 * 60,
    });
  });

  test('brands the managed login page', () => {
    authT.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 1);
  });

  test('publishes the client ID to SSM', () => {
    authT.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nakostat/sandbox/alexa/cognito/client-id',
    });
  });

  test('warns when the vendor ID is not set', () => {
    const { auth: a, authT: t } = makeStacks();
    Annotations.fromStack(a).hasWarning('*', Match.stringLikeRegexp('alexa/vendorId'));
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: Match.arrayWith(['https://layla.amazon.com/api/skill/link/VENDOR_ID_NOT_SET']),
    });
  });
});

describe('prod', () => {
  test('uses prod names', () => {
    const { skillT, authT } = makeStacks({ deployEnv: 'prod', skillId: SKILL_ID });
    skillT.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'nakostat-alexa-prod',
    });
    authT.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nakostat-alexa-prod',
    });
  });
});
