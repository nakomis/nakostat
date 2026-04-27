module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@aws-sdk|@smithy|@nodable)/)'
  ],
  setupFiles: ['<rootDir>/test/jest-setup.js'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'lambda/**/*.ts',
    '!**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      branches: 70,
      functions: 70,
      statements: 70
    }
  }
};
