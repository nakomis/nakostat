export interface NakostatConfig {
  env: string;
  aws: {
    region: string;
  };
  cognito: {
    authority: string;
    userPoolId: string;
    userPoolClientId: string;
    cognitoDomain: string;
    redirectUri: string;
    logoutUri: string;
  };
}

const Config: NakostatConfig = require('./config.json');

export default Config;
