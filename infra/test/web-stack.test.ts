import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WebStack } from '../lib/web-stack';

const MOCK_CERT_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000';

function makeStack(deployEnv: 'sandbox' | 'prod' = 'sandbox') {
  const app = new cdk.App();
  const certStack = new cdk.Stack(app, 'CertStack', { env: { account: '123456789012', region: 'us-east-1' } });
  const mockCert = acm.Certificate.fromCertificateArn(certStack, 'MockCert', MOCK_CERT_ARN);
  const stack = new WebStack(app, 'TestWebStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
    deployEnv,
    certificate: mockCert,
    crossRegionReferences: true,
  });
  return { stack, template: Template.fromStack(stack) };
}

describe('WebStack — sandbox', () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = makeStack('sandbox'));
  });

  test('creates an S3 bucket for the SPA', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('nakostat-web-.*-sandbox'),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('sandbox bucket uses DESTROY removal policy', () => {
    const buckets = template.findResources('AWS::S3::Bucket', {
      Properties: { BucketName: Match.stringLikeRegexp('nakostat-web-') },
    });
    const bucket = Object.values(buckets)[0] as { DeletionPolicy?: string };
    expect(bucket.DeletionPolicy).toBe('Delete');
  });

  test('creates a CloudFront distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('distribution uses the ACM certificate', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        ViewerCertificate: {
          AcmCertificateArn: MOCK_CERT_ARN,
          SslSupportMethod: 'sni-only',
        },
      },
    });
  });

  test('distribution serves nakostat.sandbox.nakomis.com', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: ['nakostat.sandbox.nakomis.com'],
      },
    });
  });

  test('distribution uses PRICE_CLASS_100', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        PriceClass: 'PriceClass_100',
      },
    });
  });

  test('distribution returns index.html for 403 and 404 (SPA routing)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CustomErrorResponses: Match.arrayWith([
          { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' },
          { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' },
        ]),
      },
    });
  });

  test('creates a Cognito user pool client for nakostat', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nakostat-sandbox',
      GenerateSecret: false,
      CallbackURLs: Match.arrayWith(['https://nakostat.sandbox.nakomis.com', 'http://localhost:5173']),
      LogoutURLs: Match.arrayWith(['https://nakostat.sandbox.nakomis.com', 'http://localhost:5173']),
    });
  });

  test('creates Route53 A alias for nakostat.sandbox.nakomis.com', () => {
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'nakostat.sandbox.nakomis.com.',
      Type: 'A',
    });
  });

  test('creates Route53 AAAA alias for nakostat.sandbox.nakomis.com', () => {
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'nakostat.sandbox.nakomis.com.',
      Type: 'AAAA',
    });
  });

  test('publishes client ID to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nakostat/sandbox/cognito/client-id',
      Type: 'String',
    });
  });

  test('outputs CloudFront distribution domain name and bucket name', () => {
    template.hasOutput('DistributionDomainName', { Description: Match.anyValue() });
    template.hasOutput('BucketName', { Description: Match.anyValue() });
  });
});

describe('WebStack — prod', () => {
  let template: Template;

  beforeAll(() => {
    ({ template } = makeStack('prod'));
  });

  test('distribution serves nakostat.nakomis.com', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: ['nakostat.nakomis.com'],
      },
    });
  });

  test('prod bucket uses RETAIN removal policy', () => {
    const buckets = template.findResources('AWS::S3::Bucket', {
      Properties: { BucketName: Match.stringLikeRegexp('nakostat-web-') },
    });
    const bucket = Object.values(buckets)[0] as { DeletionPolicy?: string };
    expect(bucket.DeletionPolicy).toBe('Retain');
  });

  test('creates a Cognito user pool client for prod nakostat', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nakostat-prod',
      CallbackURLs: Match.arrayWith(['https://nakostat.nakomis.com']),
    });
  });

  test('publishes client ID to SSM with prod path', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nakostat/prod/cognito/client-id',
      Type: 'String',
    });
  });
});
