#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { IotStack } from '../lib/iot-stack';
import { GithubCiStack } from '../lib/github-ci-stack';
import { DynamoStack } from '../lib/dynamo-stack';
import { WebCertStack } from '../lib/web-cert-stack';
import { WebStack } from '../lib/web-stack';

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

new DynamoStack(app, 'NakostatDynamoStack', {
  ...londonEnv,
  deployEnv,
  description: `Nakostat DynamoDB tables for sensor readings and device state (${deployEnv})`,
});

const webCertStack = new WebCertStack(app, 'NakostatWebCertStack', {
  env: { account: accountId, region: 'us-east-1' },
  deployEnv,
  crossRegionReferences: true,
  description: `ACM certificate for nakostat.${isProd ? 'nakomis.com' : 'sandbox.nakomis.com'} (must be in us-east-1 for CloudFront)`,
});

const webStack = new WebStack(app, 'NakostatWebStack', {
  ...londonEnv,
  deployEnv,
  certificate: webCertStack.certificate,
  crossRegionReferences: true,
  description: `CloudFront + S3 SPA hosting and Cognito client for nakostat (${deployEnv})`,
});

new GithubCiStack(app, 'NakostatGithubCiStack', {
  ...londonEnv,
  deployEnv,
  githubOidcProviderArn,
  webBucket: webStack.bucket,
  webDistribution: webStack.distribution,
  description: `GitHub Actions OIDC role for nakostat CI (${deployEnv})`,
});

const { version: infraVersion } = JSON.parse(fs.readFileSync('./version.json', 'utf-8'));
cdk.Tags.of(app).add('MH-Project', 'nakostat');
cdk.Tags.of(app).add('MH-Version', infraVersion);
