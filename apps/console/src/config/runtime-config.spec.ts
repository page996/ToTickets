import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig } from './runtime-config';

const apiBaseUrl = requiredTestEnvironment('CONSOLE_TEST_API_BASE_URL');
const eventsUrl = requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL');

const validConfig = {
  schemaVersion: 'console-runtime.v1',
  apiBaseUrl,
  eventsUrl,
  operatorId: 'test-operator',
  refreshIntervalMs: '2000',
  staleAfterMs: '10000',
};

describe('parseRuntimeConfig', () => {
  it('validates and normalizes an injected local configuration', () => {
    expect(parseRuntimeConfig(validConfig)).toEqual({
      schemaVersion: 'console-runtime.v1',
      apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
      eventsUrl: eventsUrl.replace(/\/$/, ''),
      operatorId: 'test-operator',
      refreshIntervalMs: 2000,
      staleAfterMs: 10000,
    });
  });

  it('rejects endpoints containing credentials', () => {
    const endpoint = new URL(apiBaseUrl);
    endpoint.username = 'not-allowed';
    expect(() => parseRuntimeConfig({ ...validConfig, apiBaseUrl: endpoint.toString() })).toThrow(
      /credentials/,
    );
  });

  it.each([
    ['a DNS hostname', 'https://console.example.invalid'],
    ['localhost', 'http://localhost'],
    ['a private-network address', 'http://192.0.2.1'],
  ])('rejects %s as a runtime endpoint', (_description, origin) => {
    const endpoint = new URL(origin);
    endpoint.port = new URL(apiBaseUrl).port;
    endpoint.pathname = '/api/v1';
    expect(() => parseRuntimeConfig({ ...validConfig, apiBaseUrl: endpoint.toString() })).toThrow(
      /local loopback endpoint/,
    );
  });

  it('accepts another explicit IPv4 loopback address', () => {
    const apiEndpoint = new URL(apiBaseUrl);
    const eventsEndpoint = new URL(eventsUrl);
    apiEndpoint.hostname = '127.255.255.254';
    eventsEndpoint.hostname = '127.255.255.254';
    expect(
      parseRuntimeConfig({
        ...validConfig,
        apiBaseUrl: apiEndpoint.toString(),
        eventsUrl: eventsEndpoint.toString(),
      }).apiBaseUrl,
    ).toContain('127.255.255.254');
  });

  it('accepts the explicit IPv6 loopback address', () => {
    const apiEndpoint = new URL(apiBaseUrl);
    const eventsEndpoint = new URL(eventsUrl);
    apiEndpoint.hostname = '[::1]';
    eventsEndpoint.hostname = '[::1]';

    expect(
      parseRuntimeConfig({
        ...validConfig,
        apiBaseUrl: apiEndpoint.toString(),
        eventsUrl: eventsEndpoint.toString(),
      }).apiBaseUrl,
    ).toContain('[::1]');
  });

  it('rejects unknown keys and incomplete stale thresholds', () => {
    expect(() => parseRuntimeConfig({ ...validConfig, token: 'not-allowed' })).toThrow(/unknown keys/);
    expect(() => parseRuntimeConfig({ ...validConfig, staleAfterMs: 1000 })).toThrow(
      /must not be shorter/,
    );
  });

  it('rejects operator identifiers that the control plane write DTOs cannot accept', () => {
    expect(() => parseRuntimeConfig({ ...validConfig, operatorId: 'operator with spaces' })).toThrow(
      /operatorId may contain only/,
    );
    expect(() => parseRuntimeConfig({ ...validConfig, operatorId: '本地操作者' })).toThrow(
      /operatorId may contain only/,
    );
  });
});

function requiredTestEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be injected for console tests`);
  return value;
}
