import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  certificate: acm.ICertificate;
}

const HOSTED_ZONES = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod:    { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
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
      this, `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const userPool = cognito.UserPool.fromUserPoolId(this, 'SharedPool', userPoolId);

    const client = new cognito.UserPoolClient(this, 'NakostatClient', {
      userPoolClientName: `nakostat-${deployEnv}`,
      userPool,
      authFlows: { userSrp: true },
      generateSecret: false,
      oAuth: {
        callbackUrls: [`https://${appDomain}/loggedin`, 'http://localhost:3000/loggedin'],
        logoutUrls:   [`https://${appDomain}/logout`,   'http://localhost:3000/logout'],
      },
    });

    // One Dark managed login branding — tied to the nakostat client (CloudFormation requires a clientId).
    const branding = new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: {
        components: {
          pageBackground: {
            image: { enabled: false },
            darkMode: { color: '282c34ff' },
          },
          pageHeader: {
            backgroundImage: { enabled: false },
            logo: { location: 'START', enabled: false },
            darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
          },
          pageFooter: {
            backgroundImage: { enabled: false },
            logo: { location: 'START', enabled: false },
            darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
          },
          form: {
            borderRadius: 8,
            backgroundImage: { enabled: false },
            logo: { location: 'CENTER', position: 'TOP', enabled: false, formInclusion: 'IN' },
            darkMode: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
          },
          pageText: {
            darkMode: { bodyColor: 'abb2bfff', headingColor: 'ffffffff', descriptionColor: '5c6370ff' },
          },
          primaryButton: {
            darkMode: {
              defaults: { backgroundColor: '2563ebff', textColor: 'ffffffff' },
              hover:    { backgroundColor: '1d4ed8ff', textColor: 'ffffffff' },
              active:   { backgroundColor: '1e40afff', textColor: 'ffffffff' },
              disabled: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
            },
          },
          secondaryButton: {
            darkMode: {
              defaults: { backgroundColor: '2c313aff', borderColor: '3e4451ff', textColor: 'abb2bfff' },
              hover:    { backgroundColor: '353b45ff', borderColor: '528bffff', textColor: 'ffffffff' },
              active:   { backgroundColor: '21252bff', borderColor: '3e4451ff', textColor: 'ffffffff' },
            },
          },
          alert: {
            borderRadius: 4,
            darkMode: { error: { backgroundColor: '3a1515ff', borderColor: 'e06c75ff' } },
          },
          idpButton: {
            standard: {
              darkMode: {
                defaults: { backgroundColor: '2c313aff', borderColor: '3e4451ff', textColor: 'abb2bfff' },
                hover:    { backgroundColor: '353b45ff', borderColor: '528bffff', textColor: 'ffffffff' },
                active:   { backgroundColor: '21252bff', borderColor: '3e4451ff', textColor: 'ffffffff' },
              },
            },
            custom: {},
          },
          phoneNumberSelector: { displayType: 'TEXT' },
          favicon: { enabledTypes: ['ICO', 'SVG'] },
        },
        componentClasses: {
          input: {
            borderRadius: 6,
            darkMode: {
              defaults: { backgroundColor: '21252bff', borderColor: '3e4451ff' },
              placeholderColor: '5c6370ff',
            },
          },
          inputLabel: {
            darkMode: { textColor: 'abb2bfff' },
          },
          inputDescription: {
            darkMode: { textColor: '5c6370ff' },
          },
          link: {
            darkMode: { defaults: { textColor: '61afefff' }, hover: { textColor: '528bffff' } },
          },
          optionControls: {
            darkMode: {
              defaults: { backgroundColor: '21252bff', borderColor: '3e4451ff' },
              selected: { backgroundColor: '2563ebff', foregroundColor: 'ffffffff' },
            },
          },
          focusState: {
            darkMode: { borderColor: '528bffff' },
          },
        },
        categories: {
          global: {
            colorSchemeMode: 'DARK',
            pageFooter: { enabled: false },
            pageHeader: { enabled: false },
            spacingDensity: 'REGULAR',
          },
        },
      },
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
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, { originAccessControl: oac }),
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
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution)),
    });

    new route53.AaaaRecord(this, 'NakostatAliasAaaa', {
      recordName: appDomain,
      zone,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution)),
    });

    new ssm.StringParameter(this, 'ClientIdParam', {
      parameterName: `/nakostat/${deployEnv}/cognito/client-id`,
      stringValue: client.userPoolClientId,
      description: `Nakostat Cognito app client ID (${deployEnv})`,
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
