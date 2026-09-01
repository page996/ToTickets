import { PolicyDeniedError } from '../src/common/errors/api-error';
import { PolicyService } from '../src/common/policy/policy.service';

describe('PolicyService', () => {
  const policy = new PolicyService();

  it.each(['click', 'purchase', 'captcha.solve', 'payment.pay', 'batch-input'])('denies prohibited intent %s', (intent) => {
    expect(() => policy.assertIntentAllowed(intent)).toThrow(PolicyDeniedError);
  });

  it('denies sensitive fields at any depth', () => {
    const request = {
      path: '/api/v1/devices',
      body: { metadata: { payment_token: 'synthetic-never-store' } },
    } as never;
    expect(() => policy.inspectRequest(request)).toThrow(PolicyDeniedError);
  });

  it('denies camel-case sensitive field aliases', () => {
    const request = {
      path: '/api/v1/devices',
      body: { metadata: { paymentToken: 'synthetic-never-store' } },
    } as never;
    expect(() => policy.inspectRequest(request)).toThrow(PolicyDeniedError);
  });

  it('allows lifecycle intent', () => {
    expect(() => policy.assertIntentAllowed('device.start')).not.toThrow();
  });
});
