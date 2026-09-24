import {
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
