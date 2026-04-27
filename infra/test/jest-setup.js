// Provide static AWS credentials so credential-provider-node does not attempt
// dynamic ESM imports (which Jest's CJS runner cannot handle without
// --experimental-vm-modules). Real calls are intercepted by aws-sdk-client-mock.
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_DEFAULT_REGION = 'eu-west-1';
