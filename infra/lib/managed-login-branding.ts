import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

// 150×150 palette PNG, base64-inlined into the template — keep it small (CloudFormation's 1 MB limit).
export const FORM_LOGO_PATH = path.join(__dirname, '../assets/nakostat-logo-150.png');

/**
 * The Nakostat One Dark managed login style. Cognito ties each style to one app
 * client, so every nakostat client that users sign in through (web, Alexa
 * account linking) gets its own copy.
 */
export function nakostatManagedLoginBranding(
  scope: Construct,
  id: string,
  props: { userPoolId: string; clientId: string },
): cognito.CfnManagedLoginBranding {
  return new cognito.CfnManagedLoginBranding(scope, id, {
    userPoolId: props.userPoolId,
    clientId: props.clientId,
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
          logo: { location: 'CENTER', position: 'TOP', enabled: true, formInclusion: 'IN' },
          darkMode: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
        },
        pageText: {
          darkMode: {
            bodyColor: 'abb2bfff',
            headingColor: 'ffffffff',
            descriptionColor: '5c6370ff',
          },
        },
        primaryButton: {
          darkMode: {
            defaults: { backgroundColor: '2563ebff', textColor: 'ffffffff' },
            hover: { backgroundColor: '1d4ed8ff', textColor: 'ffffffff' },
            active: { backgroundColor: '1e40afff', textColor: 'ffffffff' },
            disabled: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
          },
        },
        secondaryButton: {
          darkMode: {
            defaults: {
              backgroundColor: '2c313aff',
              borderColor: '3e4451ff',
              textColor: 'abb2bfff',
            },
            hover: {
              backgroundColor: '353b45ff',
              borderColor: '528bffff',
              textColor: 'ffffffff',
            },
            active: {
              backgroundColor: '21252bff',
              borderColor: '3e4451ff',
              textColor: 'ffffffff',
            },
          },
        },
        alert: {
          borderRadius: 4,
          darkMode: { error: { backgroundColor: '3a1515ff', borderColor: 'e06c75ff' } },
        },
        idpButton: {
          standard: {
            darkMode: {
              defaults: {
                backgroundColor: '2c313aff',
                borderColor: '3e4451ff',
                textColor: 'abb2bfff',
              },
              hover: {
                backgroundColor: '353b45ff',
                borderColor: '528bffff',
                textColor: 'ffffffff',
              },
              active: {
                backgroundColor: '21252bff',
                borderColor: '3e4451ff',
                textColor: 'ffffffff',
              },
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
    assets: [
      {
        category: 'FORM_LOGO',
        colorMode: 'DARK',
        extension: 'PNG',
        bytes: fs.readFileSync(FORM_LOGO_PATH).toString('base64'),
      },
    ],
  });
}
