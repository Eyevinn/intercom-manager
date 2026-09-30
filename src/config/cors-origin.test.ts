import { resolveCorsOrigin, hasCorsConfig } from './cors-origin';

describe('resolveCorsOrigin', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CORS_ORIGIN;
    delete process.env.OSC_HOSTNAME;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns null when neither CORS_ORIGIN nor OSC_HOSTNAME is set', () => {
    expect(resolveCorsOrigin()).toBeNull();
    expect(hasCorsConfig()).toBe(false);
  });

  it('returns null when both are empty/whitespace', () => {
    process.env.CORS_ORIGIN = '';
    process.env.OSC_HOSTNAME = '   ';
    expect(resolveCorsOrigin()).toBeNull();
    expect(hasCorsConfig()).toBe(false);
  });

  it('uses CORS_ORIGIN split on comma when set', () => {
    process.env.CORS_ORIGIN = 'http://localhost:5173,http://localhost:5174';
    expect(resolveCorsOrigin()).toEqual([
      'http://localhost:5173',
      'http://localhost:5174'
    ]);
    expect(hasCorsConfig()).toBe(true);
  });

  it('lets an explicit CORS_ORIGIN win over OSC_HOSTNAME', () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000';
    process.env.OSC_HOSTNAME = 'myinstance.eyevinn.technology';
    expect(resolveCorsOrigin()).toEqual(['http://localhost:3000']);
  });

  it('treats an empty CORS_ORIGIN as unset and falls back to OSC_HOSTNAME', () => {
    process.env.CORS_ORIGIN = '';
    process.env.OSC_HOSTNAME = 'myinstance.eyevinn.technology';
    expect(resolveCorsOrigin()).toEqual([
      'https://myinstance.eyevinn.technology'
    ]);
  });

  it('treats a whitespace CORS_ORIGIN as unset and falls back to OSC_HOSTNAME', () => {
    process.env.CORS_ORIGIN = '   ';
    process.env.OSC_HOSTNAME = 'myinstance.eyevinn.technology';
    expect(resolveCorsOrigin()).toEqual([
      'https://myinstance.eyevinn.technology'
    ]);
  });

  it('prefixes a bare OSC_HOSTNAME with https://', () => {
    process.env.OSC_HOSTNAME = 'myinstance.eyevinn.technology';
    expect(resolveCorsOrigin()).toEqual([
      'https://myinstance.eyevinn.technology'
    ]);
  });

  it('strips a trailing slash from a full-URL OSC_HOSTNAME', () => {
    process.env.OSC_HOSTNAME = 'https://x.osc.io/';
    expect(resolveCorsOrigin()).toEqual(['https://x.osc.io']);
  });

  it('leaves a full-URL OSC_HOSTNAME without trailing slash unchanged', () => {
    process.env.OSC_HOSTNAME = 'https://x.osc.io';
    expect(resolveCorsOrigin()).toEqual(['https://x.osc.io']);
  });

  it('preserves an explicit http:// scheme in OSC_HOSTNAME', () => {
    process.env.OSC_HOSTNAME = 'http://x.osc.io/';
    expect(resolveCorsOrigin()).toEqual(['http://x.osc.io']);
  });

  it('trims surrounding whitespace on a bare OSC_HOSTNAME', () => {
    process.env.OSC_HOSTNAME = '  myinstance.eyevinn.technology  ';
    expect(resolveCorsOrigin()).toEqual([
      'https://myinstance.eyevinn.technology'
    ]);
  });
});
