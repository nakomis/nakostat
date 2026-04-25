import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GithubCiStack } from '../lib/github-ci-stack';

const OIDC_ARN = 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const stack = new GithubCiStack(app, 'TestGithubCiStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
    githubOidcProviderArn: OIDC_ARN,
    roles: [
      {
        repo: 'nakomis/nakostat',
        description: `Assumed by nakostat CI (${deployEnv})`,
        inlinePolicies: {
          CdkDeploy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: ['arn:aws:iam::123456789012:role/cdk-hnb659fds-*'],
              }),
            ],
          }),
        },
      },
    ],
  });
  return Template.fromStack(stack);
}

describe('GithubCiStack', () => {
  let sandboxTemplate: Template;

  beforeAll(() => {
    sandboxTemplate = makeStack('sandbox');
  });

  test('creates OIDC role for nakostat CI', () => {
    sandboxTemplate.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nakomis-nakostat-github-ci-sandbox',
    });
  });

  test('role trust policy references GitHub OIDC provider', () => {
    sandboxTemplate.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Federated: OIDC_ARN },
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
              StringLike: {
                'token.actions.githubusercontent.com:sub': 'repo:nakomis/nakostat:*',
              },
            },
          }),
        ]),
      },
    });
  });

  test('role has CdkDeploy inline policy with sts:AssumeRole', () => {
    sandboxTemplate.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'CdkDeploy',
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: 'sts:AssumeRole',
                Resource: 'arn:aws:iam::123456789012:role/cdk-hnb659fds-*',
              }),
            ]),
          },
        }),
      ]),
    });
  });

  test('outputs role ARN', () => {
    sandboxTemplate.hasOutput('nakomisnakostatRoleArn', {});
  });

  test('prod uses prod suffix in role name', () => {
    const prodTemplate = makeStack('prod');
    prodTemplate.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nakomis-nakostat-github-ci-prod',
    });
  });
});
