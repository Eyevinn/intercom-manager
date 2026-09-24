// Keep the module-level side effects in server.ts (DB manager construction,
// heavy imports) from doing anything real when the module is imported here.
jest.mock('./log', () => ({
  Log: () => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  })
}));
jest.mock('./db/mongodb');
jest.mock('./db/couchdb');
jest.mock('./api', () => ({
  __esModule: true,
  default: jest.fn()
}));

import { validateRequiredEnv } from './server';

describe('validateRequiredEnv (startup env validation)', () => {
  const ORIGINAL_ENV = process.env;
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Start each test from a clean, valid environment.
    process.env = { ...ORIGINAL_ENV };
    process.env.SMB_ADDRESS = 'http://localhost:8080';
    process.env.CORS_ORIGIN = 'http://localhost:3000';
    process.env.DB_CONNECTION_STRING =
      'mongodb://localhost:27017/intercom-manager';
    delete process.env.MONGODB_CONNECTION_STRING;

    // process.exit must be mocked so the test runner is not torn down and so we
    // can assert on the exit behaviour. Throw so control flow stops like the
    // real exit would, letting us assert the exit code.
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit:${code}`);
      });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits(1) when SMB_ADDRESS is missing', () => {
    delete process.env.SMB_ADDRESS;
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits(1) when SMB_ADDRESS is empty', () => {
    process.env.SMB_ADDRESS = '';
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits(1) when CORS_ORIGIN is missing', () => {
    delete process.env.CORS_ORIGIN;
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits(1) when CORS_ORIGIN is empty', () => {
    process.env.CORS_ORIGIN = '';
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when both SMB_ADDRESS and CORS_ORIGIN are set', () => {
    expect(() => validateRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits(1) when neither DB_CONNECTION_STRING nor MONGODB_CONNECTION_STRING is set', () => {
    delete process.env.DB_CONNECTION_STRING;
    delete process.env.MONGODB_CONNECTION_STRING;
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits(1) when DB_CONNECTION_STRING is empty', () => {
    process.env.DB_CONNECTION_STRING = '';
    delete process.env.MONGODB_CONNECTION_STRING;
    expect(() => validateRequiredEnv()).toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when only MONGODB_CONNECTION_STRING is set (legacy name)', () => {
    delete process.env.DB_CONNECTION_STRING;
    process.env.MONGODB_CONNECTION_STRING =
      'mongodb://localhost:27017/intercom-manager';
    expect(() => validateRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit when DB_CONNECTION_STRING is empty but MONGODB_CONNECTION_STRING is set', () => {
    process.env.DB_CONNECTION_STRING = '';
    process.env.MONGODB_CONNECTION_STRING =
      'mongodb://localhost:27017/intercom-manager';
    expect(() => validateRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
