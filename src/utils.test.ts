import {
  isValidJwt,
  oscPlatformEnvironment,
  oscTokenServiceBaseUrl,
  sanitizeForLog
} from './utils';

describe('sanitizeForLog', () => {
  it('strips LF and CR characters', () => {
    expect(sanitizeForLog('evil\ninjected')).toBe('evilinjected');
    expect(sanitizeForLog('evil\rinjected')).toBe('evilinjected');
    expect(sanitizeForLog('a\r\nb')).toBe('ab');
  });

  it('strips ANSI escape sequences (ESC control char)', () => {
    expect(sanitizeForLog('evil\x1b[31mred\x1b[0m')).toBe('evil[31mred[0m');
  });

  it('strips other C0 controls, DEL and C1 controls', () => {
    expect(sanitizeForLog('a\x00b\x07c\x7fd\x9fe')).toBe('abcde');
  });

  it('keeps regular printable characters and spaces', () => {
    expect(sanitizeForLog('Ada B. Lovelace-1_2')).toBe('Ada B. Lovelace-1_2');
    expect(sanitizeForLog('123e4567-e89b-42d3-a456-426614174000')).toBe(
      '123e4567-e89b-42d3-a456-426614174000'
    );
  });
});

describe('oscPlatformEnvironment', () => {
  it('strips a trailing per-cluster suffix (e.g. Elastx -se)', () => {
    expect(oscPlatformEnvironment('prod-se')).toBe('prod');
    expect(oscPlatformEnvironment('stage-se')).toBe('stage');
  });

  it('leaves bare platform environments untouched', () => {
    expect(oscPlatformEnvironment('prod')).toBe('prod');
    expect(oscPlatformEnvironment('stage')).toBe('stage');
    expect(oscPlatformEnvironment('dev')).toBe('dev');
  });
});

describe('isValidJwt (#226)', () => {
  it('accepts a structurally valid JWT (header.payload.signature)', () => {
    expect(
      isValidJwt('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.dummy-signature')
    ).toBe(true);
  });

  it('accepts base64url segments (with - and _)', () => {
    expect(isValidJwt('ab-cd.ef_gh.ij-_kl')).toBe(true);
  });

  it('accepts an empty signature segment (unsecured JWT)', () => {
    expect(isValidJwt('abc.def.')).toBe(true);
  });

  it('rejects a missing token (empty string)', () => {
    expect(isValidJwt('')).toBe(false);
  });

  it('rejects a token with too few segments', () => {
    expect(isValidJwt('not-a-jwt')).toBe(false);
    expect(isValidJwt('only.two')).toBe(false);
  });

  it('rejects a token with too many segments', () => {
    expect(isValidJwt('a.b.c.d')).toBe(false);
  });

  it('rejects a token with an empty header or payload segment', () => {
    expect(isValidJwt('.b.c')).toBe(false);
    expect(isValidJwt('a..c')).toBe(false);
  });

  it('rejects segments containing invalid characters', () => {
    expect(isValidJwt('ab+cd.ef.gh')).toBe(false);
    expect(isValidJwt('ab.ef/gh.ij')).toBe(false);
    expect(isValidJwt('a b.c.d')).toBe(false);
  });
});

describe('oscTokenServiceBaseUrl', () => {
  it('builds the shared platform host, not the hosting-cluster host', () => {
    expect(oscTokenServiceBaseUrl('prod-se')).toBe(
      'https://token.svc.prod.osaas.io'
    );
    expect(oscTokenServiceBaseUrl('prod')).toBe(
      'https://token.svc.prod.osaas.io'
    );
    expect(oscTokenServiceBaseUrl('stage-se')).toBe(
      'https://token.svc.stage.osaas.io'
    );
  });
});
