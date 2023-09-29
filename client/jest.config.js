module.exports = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  setupFiles: [`./scripts/test-setup.ts`],
  modulePathIgnorePatterns: ['./dist', './examples'],
};
