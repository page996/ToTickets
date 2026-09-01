import {
  ACTIVE_EXPOSURE_PROFILE,
  EXPOSURE_PROFILES,
  validateBindHost,
} from '../src/config/exposure-profile';

describe('exposure profiles', () => {
  it('keeps the runtime profile loopback-only', () => {
    expect(ACTIVE_EXPOSURE_PROFILE).toBe('loopback.v1');
    expect(EXPOSURE_PROFILES[ACTIVE_EXPOSURE_PROFILE].remoteAllowed).toBe(false);
    expect(validateBindHost('127.0.0.1')).toBe('127.0.0.1');
    expect(() => validateBindHost('192.0.2.10')).toThrow('127/8');
  });

  it('describes, but does not enable, the future authenticated profile', () => {
    expect(EXPOSURE_PROFILES['authenticated-tls.v1'].requiredControls).toEqual(
      expect.arrayContaining(['authentication', 'tls', 'rbac', 'csrf']),
    );
    expect(() => validateBindHost('192.0.2.10', 'authenticated-tls.v1')).toThrow('not enabled');
  });
});

