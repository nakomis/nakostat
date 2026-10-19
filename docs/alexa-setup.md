# Alexa skill setup

Nakostat appears in Alexa as one thermostat called **Heating**: set or nudge the target temperature,
switch between Heat and Off, and ask for the room temperature. It is a private Smart Home skill that
stays in the *development* stage, so only Amazon accounts on Martin's developer account can enable it.

## How it fits together

| Piece | Where | Stack |
|---|---|---|
| Skill Lambda `nakostat-alexa-{env}` | eu-west-1 (Alexa's EU endpoint region) | `NakostatAlexaStack` |
| Cognito app client `nakostat-alexa-{env}` (account linking) | eu-west-2, on the shared pool | `NakostatAlexaAuthStack` |
| State table, IoT Core | eu-west-2 | existing stacks |

The Lambda reads the daemon's `pi` item from `nakostat-state-{env}` and publishes the same
`nakostat/{env}/api/setpoint` and `api/mode` messages as the web API, with `userId` set to the Cognito
`sub` of the linked account. The Pi daemon stays the authority; the skill replies optimistically.
The thermostat reports itself `UNREACHABLE` when the Pi's state is more than 5 minutes old.

The skill ID and vendor ID come from SSM, looked up at synth time. Until they exist the stacks
synthesise with placeholders: the Lambda has **no Alexa trigger** and the account-linking redirect
URLs are dummies (CDK prints a warning for each). So the first setup is a two-step deploy.

| SSM parameter | Region | Value |
|---|---|---|
| `/nakostat/{env}/alexa/skillId` | **eu-west-1** | `amzn1.ask.skill.…` |
| `/nakostat/{env}/alexa/vendorId` | **eu-west-2** | your developer vendor ID, e.g. `M2ABC…` |
| `/nakostat/{env}/alexa/cognito/client-id` | eu-west-2 | written by `NakostatAlexaAuthStack` |

Below, `ENV` is `sandbox` or `prod` and `PROFILE` is `nakom.is-sandbox` or `nakom.is-admin`. Each
environment needs its own skill. Only enable one of them in the Alexa app at a time: both discover a
device called "Heating".

## One-off: bootstrap eu-west-1

The sandbox account is already bootstrapped in eu-west-1; **prod is not** (CI's prod deploy will fail
on the Alexa stack until it is):

```sh
cd infra
pnpm exec cdk bootstrap aws://637423226886/eu-west-1 --profile nakom.is-admin
```

## 1. First deploy (no skill yet)

```sh
cd infra
NPM_ENVIRONMENT=ENV pnpm exec cdk deploy --profile PROFILE \
  NakostatAlexaAuthStack NakostatAlexaStack
```

(Or let CI deploy it.) Note the `AlexaFunctionArn` output:
`arn:aws:lambda:eu-west-1:<account>:function:nakostat-alexa-ENV`.

## 2. Create the skill

In the [Alexa developer console](https://developer.amazon.com/alexa/console/ask):

1. **Create Skill** → name `Nakostat` (or `Nakostat Sandbox`), primary locale **English (UK)**,
   experience **Smart Home**, model **Smart Home**, hosting **Provision your own**. Create.
2. Copy the **Skill ID** from the Smart Home page (`amzn1.ask.skill.…`). Don't save the endpoint yet.
3. Find your **vendor ID**: *Settings* (top right) → *Your vendor ID*, or `ask smapi list-vendors`.
   The Account Linking page also lists the three *Alexa Redirect URLs*, which end in it.

Alternatively, with the ASK CLI (`ask configure` once): fill the ARN placeholders in
`infra/skill-package/skill.json` and run
`ask smapi create-skill-for-vendor --vendor-id <vendorId> --manifest "file:infra/skill-package/skill.json"`.
The skill is created, but its endpoint check fails until step 4 adds the trigger; re-run it as
`ask smapi update-skill-manifest --skill-id <skillId> --stage development --manifest "file:…"` afterwards.

## 3. Set the parameters

```sh
aws ssm put-parameter --profile PROFILE --region eu-west-1 --type String \
  --name /nakostat/ENV/alexa/skillId --value amzn1.ask.skill.XXXXXXXX
aws ssm put-parameter --profile PROFILE --region eu-west-2 --type String \
  --name /nakostat/ENV/alexa/vendorId --value MXXXXXXXXXXXX
```

## 4. Second deploy (adds the trigger and the real redirect URLs)

The SSM lookups are cached in `infra/cdk.context.json` (git-ignored). Clear it first so the new
values are picked up:

```sh
cd infra
rm -f cdk.context.json
NPM_ENVIRONMENT=ENV pnpm exec cdk deploy --profile PROFILE \
  NakostatAlexaAuthStack NakostatAlexaStack
```

The deploy should print no `alexa/skillId` or `alexa/vendorId` warnings. CI looks the values up
fresh on every run, so later CI deploys keep them.

## 5. Point the skill at the Lambda

Smart Home page of the skill → **Default endpoint**: the `AlexaFunctionArn`; tick **Europe, India**
and paste the same ARN. **Save**. (The console checks the Lambda's Alexa trigger, which step 4 created.)

## 6. Account linking

Get the client ID and secret:

```sh
POOL=$(aws ssm get-parameter --profile PROFILE --region eu-west-2 \
  --name /nakomis-infra/ENV/cognito/user-pool-id --query Parameter.Value --output text)
CLIENT=$(aws ssm get-parameter --profile PROFILE --region eu-west-2 \
  --name /nakostat/ENV/alexa/cognito/client-id --query Parameter.Value --output text)
aws cognito-idp describe-user-pool-client --profile PROFILE --region eu-west-2 \
  --user-pool-id "$POOL" --client-id "$CLIENT" \
  --query 'UserPoolClient.[ClientId,ClientSecret]' --output text
```

In the console, **Account Linking** (Smart Home skills always require it):

| Field | Value |
|---|---|
| Authorization grant type | Auth Code Grant |
| Web Authorization URI | `https://login.nakomis.com/oauth2/authorize` (sandbox: `login.sandbox.nakomis.com`) |
| Access Token URI | `https://login.nakomis.com/oauth2/token` (sandbox: `login.sandbox.nakomis.com`) |
| Your Client ID | `$CLIENT` |
| Your Secret | the secret from above |
| Your Authentication Scheme | HTTP Basic (Recommended) |
| Scope | `openid`, `profile`, `email` (three entries) |
| Default Access Token Expiration Time | 3600 |

Save. The three *Alexa Redirect URLs* shown must match the client's callback URLs (they will once
the vendor ID parameter is right).

With the ASK CLI instead: copy `infra/skill-package/account-linking.json` **outside the repo**, fill in
`LOGIN_DOMAIN`, `CLIENT_ID` and `CLIENT_SECRET`, then
`ask smapi update-account-linking-info --skill-id <skillId> --stage development --account-linking-request "file:/path/to/copy.json"`.
Never commit the filled-in copy.

## 7. Enable and discover

1. Alexa app → *More* → *Skills & Games* → *Your Skills* → *Dev* → **Nakostat** → *Enable to use*.
2. Sign in on the Nakomis (Cognito) page with your usual account.
3. *Discover devices*. **Heating** appears as a thermostat.

## Revoking Alexa's access

The Alexa app client's refresh tokens last 10 years (so the link never silently breaks), which
means a leaked or unwanted link has to be revoked deliberately. Any one of these works:

- **Revoke the refresh token**: `aws cognito-idp revoke-token --client-id "$CLIENT" --client-secret
  "<secret>" --token "<refresh token>"` (the client has token revocation enabled). This invalidates
  that token and the access tokens issued from it.
- **Global sign-out of the user**: `aws cognito-idp admin-user-global-sign-out --user-pool-id "$POOL"
  --username <user>` revokes every refresh token for that user, across all clients.
- **Disable the client**: remove or replace the Alexa client in `infra/lib/alexa-stack.ts` and
  deploy, which cuts off every linked account at once. Then disable the skill in the Alexa app and
  re-link afterwards.

Refresh-token rotation is not enabled: we have not confirmed Alexa keeps a rotated refresh token,
and a mismatch would break the link without any error.

## Things to say

- "Alexa, set the heating to twenty degrees." (an override until the next schedule change)
- "Alexa, turn the heating up." / "Alexa, turn the heating down by two degrees."
- "Alexa, turn the heating off." / "Alexa, set the heating to heat."
- "Alexa, what's the heating set to?"
- "Alexa, what's the temperature of the heating?"

Valid setpoints are 5–30 °C. Fahrenheit requests are converted to the nearest half degree. A nudge
that would go past a limit stops at the limit; an explicit setpoint outside it is refused.

## Troubleshooting

- **Logs**: CloudWatch `/aws/lambda/nakostat-alexa-ENV` in **eu-west-1**.
- **Discovery finds nothing**: the access token failed verification (it must be a Cognito *access*
  token from the Alexa client); look for `Token verification failed` in the logs.
- **"Heating is not responding"**: the Pi hasn't published `pi/state` for 5 minutes, or there is no
  `pi` item in the state table yet.
- **Endpoint won't save in the console**: the trigger is missing. Check the skill ID parameter (in
  eu-west-1), clear `cdk.context.json` and redeploy.
- **Linking fails with `redirect_mismatch`**: the vendor ID parameter (in eu-west-2) is wrong or
  wasn't picked up; clear `cdk.context.json` and redeploy `NakostatAlexaAuthStack`.
