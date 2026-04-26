import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface WebCertStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

const HOSTED_ZONES = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod:    { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
};

export class WebCertStack extends cdk.Stack {
  readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: WebCertStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;
    const { hostedZoneId, zoneName } = HOSTED_ZONES[deployEnv];

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId,
      zoneName,
    });

    this.certificate = new acm.Certificate(this, 'Cert', {
      domainName: `nakostat.${zoneName}`,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
