import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GithubCiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  /** ARN of the GitHub OIDC provider in this account. */
  githubOidcProviderArn: string;
}

export class GithubCiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubCiStackProps) {
    super(scope, id, props);

    const { deployEnv, githubOidcProviderArn } = props;

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
      },
    });

    new cdk.CfnOutput(this, 'NakostatCiRoleArn', {
      value: role.roleArn,
      description: `IAM role for nakostat GitHub Actions CI (${deployEnv})`,
    });
  }
}
