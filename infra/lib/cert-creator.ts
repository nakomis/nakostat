import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface CertCreatorProps {
  /** IoT Thing name the certificate will be attached to. */
  thingName: string;
  /** IoT policy name to attach to the certificate. */
  policyName: string;
  /** SSM parameter path for the certificate PEM (SecureString). */
  certPemPath: string;
  /** SSM parameter path for the private key (SecureString). */
  privKeyPath: string;
}

export class CertCreator extends Construct {
  /** The certificate ID, available as a CloudFormation output. */
  readonly certificateId: string;

  constructor(scope: Construct, id: string, props: CertCreatorProps) {
    super(scope, id);

    const fn = new nodejs.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../lambda/cert-creator/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      bundling: {
        externalModules: [],
      },
    });

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'iot:CreateKeysAndCertificate',
        'iot:AttachThingPrincipal',
        'iot:DetachThingPrincipal',
        'iot:AttachPolicy',
        'iot:DetachPolicy',
        'iot:UpdateCertificate',
        'iot:DeleteCertificate',
        'iot:ListCertificates',
      ],
      resources: ['*'],
    }));

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${props.certPemPath}`,
        `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${props.privKeyPath}`,
      ],
    }));

    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: fn,
    });

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        thingName: props.thingName,
        policyName: props.policyName,
        certPemPath: props.certPemPath,
        privKeyPath: props.privKeyPath,
      },
    });

    this.certificateId = resource.getAttString('PhysicalResourceId');
  }
}
