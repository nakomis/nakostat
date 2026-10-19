import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { nakostatManagedLoginBranding } from './managed-login-branding';

/** Returned by the SSM lookups until Martin has created the skill and set the parameters. */
export const SKILL_ID_PLACEHOLDER = 'SKILL_ID_NOT_SET';
export const VENDOR_ID_PLACEHOLDER = 'VENDOR_ID_NOT_SET';

const SKILL_ID_PATTERN = /^amzn1\.ask\.skill\.[0-9a-f-]+$/;

/** Alexa's account-linking redirect hosts (UK/EU skills use layla; all three are listed by the console). */
export const alexaRedirectUris = (vendorId: string) => [
  `https://layla.amazon.com/api/skill/link/${vendorId}`,
  `https://pitangui.amazon.com/api/skill/link/${vendorId}`,
  `https://alexa.amazon.co.jp/api/skill/link/${vendorId}`,
];

// ── Account linking (eu-west-2, alongside the shared user pool) ──────────────

export interface AlexaAuthStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  /** Overrides the `/nakostat/{env}/alexa/vendorId` SSM lookup (tests, or `-c`). */
  vendorId?: string;
}

/**
 * The Cognito app client Alexa uses for account linking. A Cognito client must
 * live in its pool's region, so this is separate from the eu-west-1 skill stack.
 */
export class AlexaAuthStack extends cdk.Stack {
  readonly userPoolId: string;
  readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AlexaAuthStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;

    // Synth-time lookup with a placeholder, so synth (and the first deploy) work
    // before the skill exists. The redirect URIs only need the vendor ID.
    const vendorId =
      props.vendorId ??
      ssm.StringParameter.valueFromLookup(
        this,
        `/nakostat/${deployEnv}/alexa/vendorId`,
        VENDOR_ID_PLACEHOLDER,
      );
    if (vendorId === VENDOR_ID_PLACEHOLDER) {
      cdk.Annotations.of(this).addWarningV2(
        'nakostat:alexaVendorIdMissing',
        `SSM /nakostat/${deployEnv}/alexa/vendorId is not set; account linking redirect URIs are placeholders. See docs/alexa-setup.md.`,
      );
    }

    this.userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const userPool = cognito.UserPool.fromUserPoolId(this, 'SharedPool', this.userPoolId);

    this.client = new cognito.UserPoolClient(this, 'AlexaClient', {
      userPoolClientName: `nakostat-alexa-${deployEnv}`,
      userPool,
      generateSecret: true,
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE, cognito.OAuthScope.EMAIL],
        callbackUrls: alexaRedirectUris(vendorId),
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      // Alexa refreshes hourly, but Cognito doesn't rotate refresh tokens, so
      // the link would silently break when the first refresh token expires.
      // Keep it for the maximum (10 years).
      refreshTokenValidity: cdk.Duration.days(3650),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    const branding = nakostatManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: this.userPoolId,
      clientId: this.client.userPoolClientId,
    });
    branding.node.addDependency(this.client);

    new ssm.StringParameter(this, 'AlexaClientIdParam', {
      parameterName: `/nakostat/${deployEnv}/alexa/cognito/client-id`,
      stringValue: this.client.userPoolClientId,
      description: `Nakostat Alexa account-linking Cognito client ID (${deployEnv})`,
    });

    new cdk.CfnOutput(this, 'AlexaClientId', {
      value: this.client.userPoolClientId,
      description:
        'Cognito client ID for Alexa account linking (secret: aws cognito-idp describe-user-pool-client)',
    });
  }
}

// ── Smart Home skill Lambda (eu-west-1, Alexa's EU endpoint region) ──────────

export interface AlexaStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  /** Shared user pool ID (from AlexaAuthStack, cross-region). */
  userPoolId: string;
  /** Alexa account-linking client ID (from AlexaAuthStack, cross-region). */
  alexaClientId: string;
  /** Overrides the `/nakostat/{env}/alexa/skillId` SSM lookup (tests, or `-c`). */
  skillId?: string;
  /** Region holding the state table and IoT Core. */
  homeRegion?: string;
}

export class AlexaStack extends cdk.Stack {
  readonly fn: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AlexaStackProps) {
    super(scope, id, props);
    const { deployEnv, userPoolId, alexaClientId } = props;
    const homeRegion = props.homeRegion ?? 'eu-west-2';

    // The Lambda trigger must name the skill ID, but the skill can only point at
    // this Lambda once it exists: deploy once with the placeholder (no trigger),
    // create the skill, set the parameter, deploy again. See docs/alexa-setup.md.
    const skillId =
      props.skillId ??
      ssm.StringParameter.valueFromLookup(
        this,
        `/nakostat/${deployEnv}/alexa/skillId`,
        SKILL_ID_PLACEHOLDER,
      );

    const stateTableName = `nakostat-state-${deployEnv}`;
    const stateTableArn = `arn:aws:dynamodb:${homeRegion}:${this.account}:table/${stateTableName}`;

    this.fn = new nodejs.NodejsFunction(this, 'AlexaHandler', {
      functionName: `nakostat-alexa-${deployEnv}`,
      description: 'Nakostat Alexa Smart Home skill',
      entry: path.join(__dirname, '../lambda/alexa/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(8),
      memorySize: 256,
      environment: {
        DEPLOY_ENV: deployEnv,
        TARGET_REGION: homeRegion,
        STATE_TABLE_NAME: stateTableName,
        USER_POOL_ID: userPoolId,
        ALEXA_CLIENT_ID: alexaClientId,
      },
      bundling: { externalModules: [] },
      logGroup: new logs.LogGroup(this, 'AlexaHandlerLogs', {
        logGroupName: `/aws/lambda/nakostat-alexa-${deployEnv}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [stateTableArn],
        conditions: {
          'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['pi', 'heatlink'] },
        },
      }),
    );

    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iot:Publish'],
        resources: ['setpoint', 'mode'].map(
          (t) => `arn:aws:iot:${homeRegion}:${this.account}:topic/nakostat/${deployEnv}/api/${t}`,
        ),
      }),
    );

    if (skillId !== SKILL_ID_PLACEHOLDER) {
      if (!SKILL_ID_PATTERN.test(skillId)) {
        throw new Error(`Alexa skill ID "${skillId}" doesn't look like amzn1.ask.skill.<uuid>`);
      }
      this.fn.addPermission('AlexaSmartHomeTrigger', {
        principal: new iam.ServicePrincipal('alexa-connectedhome.amazon.com'),
        action: 'lambda:InvokeFunction',
        eventSourceToken: skillId,
      });
    } else {
      cdk.Annotations.of(this).addWarningV2(
        'nakostat:alexaSkillIdMissing',
        `SSM /nakostat/${deployEnv}/alexa/skillId is not set (in ${this.region}); the Alexa trigger is not created. See docs/alexa-setup.md.`,
      );
    }

    new cdk.CfnOutput(this, 'AlexaFunctionArn', {
      value: this.fn.functionArn,
      description: 'Smart Home skill endpoint (default and EU) for the Alexa developer console',
    });
  }
}
