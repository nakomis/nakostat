import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GithubCiRoleConfig {
  /** GitHub repo in `owner/name` format, e.g. `nakomis/nakostat`. */
  repo: string;
  /** Managed policy ARNs to attach to the role. */
  policyArns?: string[];
  /** Inline policies to attach to the role. */
  inlinePolicies?: { [name: string]: iam.PolicyDocument };
  description?: string;
}

export interface GithubCiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  /** ARN of the GitHub OIDC provider in this account. */
  githubOidcProviderArn: string;
  /** Roles to create, one per downstream repo. */
  roles: GithubCiRoleConfig[];
}

export class GithubCiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubCiStackProps) {
    super(scope, id, props);

    const { deployEnv, githubOidcProviderArn, roles } = props;

    const githubOidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this, 'GithubOidc', githubOidcProviderArn,
    );

    for (const config of roles) {
      const repoSlug = config.repo.replace('/', '-');
      const outputId = config.repo.replace(/[^a-zA-Z0-9]/g, '') + 'RoleArn';
      const roleName = `${repoSlug}-github-ci-${deployEnv}`;

      const role = new iam.Role(this, `${repoSlug}-role`, {
        roleName,
        assumedBy: new iam.WebIdentityPrincipal(
          githubOidc.openIdConnectProviderArn,
          {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': `repo:${config.repo}:*`,
            },
          },
        ),
        description: config.description ?? `Assumed by ${config.repo} GitHub Actions CI (${deployEnv})`,
        inlinePolicies: config.inlinePolicies,
      });

      (config.policyArns ?? []).forEach((arn, i) => {
        role.addManagedPolicy(
          iam.ManagedPolicy.fromManagedPolicyArn(this, `${repoSlug}-policy-${i}`, arn),
        );
      });

      new cdk.CfnOutput(this, outputId, {
        value: role.roleArn,
        description: `IAM role for ${config.repo} GitHub Actions CI (${deployEnv})`,
      });
    }
  }
}
