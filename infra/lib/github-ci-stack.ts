import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface GithubCiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  /** ARN of the GitHub OIDC provider in this account. */
  githubOidcProviderArn: string;
  /** Web S3 bucket — grants the CI role permission to deploy SPA assets. */
  webBucket?: s3.IBucket;
  /** CloudFront distribution — grants the CI role permission to create invalidations. */
  webDistribution?: cloudfront.IDistribution;
}

export class GithubCiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubCiStackProps) {
    super(scope, id, props);

    const { deployEnv, githubOidcProviderArn, webBucket, webDistribution } = props;

    const githubOidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this, 'GithubOidc', githubOidcProviderArn,
    );

    const role = new iam.Role(this, 'NakostatCiRole', {
      roleName: `nakomis-nakostat-github-ci-${deployEnv}`,
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:nakomis/nakostat:*',
          },
        },
      ),
      description: `Assumed by nakostat GitHub Actions CI (${deployEnv})`,
      inlinePolicies: {
        CdkDeploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
            }),
          ],
        }),
        ...(webBucket && webDistribution ? {
          WebDeploy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
                resources: [webBucket.bucketArn, `${webBucket.bucketArn}/*`],
              }),
              new iam.PolicyStatement({
                actions: ['cloudfront:CreateInvalidation'],
                resources: [`arn:aws:cloudfront::${this.account}:distribution/${webDistribution.distributionId}`],
              }),
              new iam.PolicyStatement({
                actions: ['ssm:GetParameter'],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/nakostat/*`],
              }),
            ],
          }),
        } : {}),
      },
    });

    new cdk.CfnOutput(this, 'NakostatCiRoleArn', {
      value: role.roleArn,
      description: `IAM role for nakostat GitHub Actions CI (${deployEnv})`,
    });
  }
}
