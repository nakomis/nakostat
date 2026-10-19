module.exports = {
  testEnvironment: 'node',
  // Claude Code sessions set TEST_MAX_WORKERS (~/.claude/settings.json) so parallel agents don't
  // swamp the Mac; unset (your terminal, CI) keeps Jest's default.
  ...(process.env.TEST_MAX_WORKERS && { maxWorkers: Number(process.env.TEST_MAX_WORKERS) }),
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@aws-sdk|@smithy|@nodable)/)'],
  setupFiles: ['<rootDir>/test/jest-setup.js'],
  collectCoverageFrom: ['lib/**/*.ts', 'lambda/**/*.ts', '!**/*.d.ts'],
  coverageThreshold: {
    global: {
      lines: 70,
      branches: 70,
      functions: 70,
      statements: 70,
    },
  },
};
