module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: ['node_modules/(?!uuid)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    'node_modules/uuid/.+\\.js$': 'ts-jest'
  }
};
