import { describe, expect, it } from 'vitest';
import { configuredDevHost, configuredEndpoint } from '../../vite.config';

describe('Vite development boundary validation', () => {
  it.each([
    ['a DNS hostname', 'https://console.example.invalid/api/v1'],
    ['localhost', 'http://localhost/api/v1'],
    ['a non-loopback address', 'http://192.0.2.1/api/v1'],
  ])('rejects %s as an API endpoint', (_description, endpoint) => {
    expect(() => configuredEndpoint(endpoint, 'api', ['http:', 'https:'], '/api/v1')).toThrow(
      /local loopback endpoint/,
    );
  });

  it('accepts an explicit IPv6 loopback endpoint', () => {
    expect(configuredEndpoint('http://[::1]/api/v1', 'api', ['http:'], '/api/v1')).toBe(
      'http://[::1]/api/v1',
    );
  });

  it.each(['localhost', '0.0.0.0', '192.0.2.1', '127.0.0.1:5173'])(
    'rejects %s as a development bind host',
    (host) => {
      expect(() => configuredDevHost(host)).toThrow(/loopback host/);
    },
  );

  it('accepts a loopback bind host without a port', () => {
    expect(configuredDevHost('127.255.255.254')).toBe('127.255.255.254');
    expect(configuredDevHost('::1')).toBe('::1');
  });
});
