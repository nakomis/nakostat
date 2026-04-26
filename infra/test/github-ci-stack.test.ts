import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GithubCiStack } from '../lib/github-ci-stack';

const OIDC_ARN = 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com';
const BUCKET_ARN = 'arn:aws:s3:::nakostat-web-123456789012-sandbox';
const DISTRIBUTION_ID = 'EABCDEF1234567';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox', withWebProps = false) {
  const app = new cdk.App();
  const stack = new GithubCiStack(app, 'TestGithubCiStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
    githubOidcProviderArn: OIDC_ARN,
    ...(withWebProps ? {
      webBucket: s3.Bucket.fromBucketArn(new cdk.Stack(app, 'BucketStack'), 'Bucket', BUCKET_ARN),
      webDistribution: cloudfront.Distribution.fromDistributionAttributes(
        new cdk.Stack(app, 'CfStack'), 'Dist',
        { distributionId: DISTRIBUTION_ID, domainName: 'abc.cloudfront.net' },
      ),
    } : {}),
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

  test('role has CdkDeploy inline policy with sts:AssumeRole on CDK bootstrap roles', () => {
    sandboxTemplate.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'CdkDeploy',
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: 'sts:AssumeRole',
                Resource: Match.stringLikeRegexp('cdk-hnb659fds-\\*'),
              }),
            ]),
          },
        }),
      ]),
    });
  });

  test('outputs role ARN', () => {
    sandboxTemplate.hasOutput('NakostatCiRoleArn', {});
  });

  test('prod uses prod suffix in role name', () => {
    const prodTemplate = makeStack('prod');
    prodTemplate.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nakomis-nakostat-github-ci-prod',
    });
  });

  describe('with webBucket and webDistribution', () => {
    let webTemplate: Template;

    beforeAll(() => {
      webTemplate = makeStack('sandbox', true);
    });

    test('role has WebDeploy policy with S3 permissions on the bucket', () => {
      webTemplate.hasResourceProperties('AWS::IAM::Role', {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: 'WebDeploy',
            PolicyDocument: {
              Statement: Match.arrayWith([
                Match.objectLike({
                  Action: Match.arrayWith(['s3:PutObject', 's3:DeleteObject', 's3:ListBucket']),
                  Resource: Match.arrayWith([BUCKET_ARN, `${BUCKET_ARN}/*`]),
                }),
              ]),
            },
          }),
        ]),
      });
    });

    test('role has WebDeploy policy with CloudFront CreateInvalidation', () => {
      webTemplate.hasResourceProperties('AWS::IAM::Role', {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: 'WebDeploy',
            PolicyDocument: {
              Statement: Match.arrayWith([
                Match.objectLike({
                  Action: 'cloudfront:CreateInvalidation',
                  Resource: Match.stringLikeRegexp(DISTRIBUTION_ID),
                }),
              ]),
            },
          }),
        ]),
      });
    });

    test('role has WebDeploy policy with SSM GetParameter on nakostat namespace', () => {
      webTemplate.hasResourceProperties('AWS::IAM::Role', {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: 'WebDeploy',
            PolicyDocument: {
              Statement: Match.arrayWith([
                Match.objectLike({
                  Action: 'ssm:GetParameter',
                  Resource: Match.stringLikeRegexp('parameter/nakostat/\\*'),
                }),
              ]),
            },
          }),
        ]),
      });
    });
  });
});
