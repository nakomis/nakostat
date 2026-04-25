#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { IotStack } from '../lib/iot-stack';
import { GithubCiStack } from '../lib/github-ci-stack';

const npmEnvironment = process.env.NPM_ENVIRONMENT;
if (!npmEnvironment) {
  throw new Error(
    'NPM_ENVIRONMENT is not set. Use `npm run deploy-sandbox` or `npm run deploy-prod`.',
  );
}
if (npmEnvironment !== 'sandbox' && npmEnvironment !== 'prod') {
  throw new Error(
    `Unknown NPM_ENVIRONMENT "${npmEnvironment}". Must be "sandbox" or "prod".`,
  );
}

const deployEnv = npmEnvironment as 'sandbox' | 'prod';
const isProd = deployEnv === 'prod';

const sandboxAccountId = '975050268859';
const prodAccountId = '637423226886';
const accountId = isProd ? prodAccountId : sandboxAccountId;

const londonEnv = { env: { account: accountId, region: 'eu-west-2' } };

const githubOidcProviderArn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

const app = new cdk.App();

new IotStack(app, 'NakostatIotStack', {
  ...londonEnv,
  deployEnv,
  description: `Nakostat IoT Things, certificates, and policies (${deployEnv})`,
});

new GithubCiStack(app, 'NakostatGithubCiStack', {
  ...londonEnv,
  deployEnv,
  githubOidcProviderArn,
  description: `GitHub Actions OIDC role for nakostat CI (${deployEnv})`,
});
