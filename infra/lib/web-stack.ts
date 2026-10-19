import * as cdk from 'aws-cdk-lib';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { nakostatManagedLoginBranding } from './managed-login-branding';

export interface WebStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  certificate: acm.ICertificate;
}

export { FORM_LOGO_PATH } from './managed-login-branding';

const HOSTED_ZONES = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod: { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
};

export class WebStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { deployEnv, certificate } = props;
    const isProd = deployEnv === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const { hostedZoneId, zoneName } = HOSTED_ZONES[deployEnv];
    const appDomain = `nakostat.${zoneName}`;

    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const userPool = cognito.UserPool.fromUserPoolId(this, 'SharedPool', userPoolId);

    const client = new cognito.UserPoolClient(this, 'NakostatClient', {
      userPoolClientName: `nakostat-${deployEnv}`,
      userPool,
      authFlows: { userSrp: true },
      generateSecret: false,
      oAuth: {
        callbackUrls: [`https://${appDomain}/loggedin`, 'http://localhost:3000/loggedin'],
        logoutUrls: [`https://${appDomain}/logout`, 'http://localhost:3000/logout'],
      },
    });

    // One Dark managed login branding — tied to the nakostat client (CloudFormation requires a clientId).
    const branding = nakostatManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
    });
    branding.node.addDependency(client);

    this.bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `nakostat-web-${this.account}-${deployEnv}`,
      removalPolicy,
      autoDeleteObjects: !isProd,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      originAccessControlName: `nakostat-${deployEnv}`,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      domainNames: [appDomain],
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName,
    });

    new route53.ARecord(this, 'NakostatAliasA', {
      recordName: appDomain,
      zone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      ),
    });

    new route53.AaaaRecord(this, 'NakostatAliasAaaa', {
      recordName: appDomain,
      zone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      ),
    });

    const loginDomain = ssm.StringParameter.valueForStringParameter(
      this,
      `/nakomis-infra/${deployEnv}/cognito/login-domain`,
    );

    new ssm.StringParameter(this, 'ClientIdParam', {
      parameterName: `/nakostat/${deployEnv}/cognito/client-id`,
      stringValue: client.userPoolClientId,
      description: `Nakostat Cognito app client ID (${deployEnv})`,
    });

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/nakostat/${deployEnv}/cognito/user-pool-id`,
      stringValue: userPoolId,
      description: `Shared NakomisUserPool ID (${deployEnv})`,
    });

    new ssm.StringParameter(this, 'LoginDomainParam', {
      parameterName: `/nakostat/${deployEnv}/cognito/login-domain`,
      stringValue: loginDomain,
      description: `Cognito login domain for nakostat (${deployEnv})`,
    });

    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: `/nakostat/${deployEnv}/web/bucket-name`,
      stringValue: this.bucket.bucketName,
      description: `Nakostat web S3 bucket name (${deployEnv})`,
    });

    new ssm.StringParameter(this, 'DistributionIdParam', {
      parameterName: `/nakostat/${deployEnv}/web/distribution-id`,
      stringValue: this.distribution.distributionId,
      description: `Nakostat CloudFront distribution ID (${deployEnv})`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.domainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket for nakostat SPA assets',
    });
  }
}
