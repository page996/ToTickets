import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  configuredOrigins,
  createTauriConfigOverlay,
} from './tauri-config-overlay.mjs';

const apiBaseUrl = requiredTestEnvironment('CONSOLE_TEST_API_BASE_URL');
const eventsUrl = requiredTestEnvironment('CONSOLE_TEST_EVENTS_URL');
const environment = Object.freeze({
  CONSOLE_API_BASE_URL: apiBaseUrl,
  CONSOLE_EVENTS_URL: eventsUrl,
});
const baseConfig = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const baseCsp = baseConfig.app.security.csp;
const mainCapability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
);

describe('Tauri CSP overlay', () => {
  it('adds only the configured API and event origins to the host-neutral baseline', () => {
    const origins = configuredOrigins(environment);
    const overlay = createTauriConfigOverlay(baseCsp, environment);
    const connectSources = directiveSources(overlay.app.security.csp, 'connect-src');

    expect(connectSources).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', origins.apiOrigin, origins.eventsOrigin]);
    expect(overlay.app.security.csp).toContain("default-src 'self'");
    expect(overlay.app.security.csp).toContain("object-src 'none'");
    expect(baseCsp).not.toContain(origins.apiOrigin);
    expect(baseCsp).not.toContain(origins.eventsOrigin);
  });

  it('rejects endpoint paths, credentials, and query data that differ from the runtime contract', () => {
    const withQuery = new URL(apiBaseUrl);
    withQuery.searchParams.set('unexpected', 'value');
    const withCredentials = new URL(apiBaseUrl);
    withCredentials.username = 'not-allowed';
    const wrongPath = new URL(eventsUrl);
    wrongPath.pathname = `${wrongPath.pathname}/unexpected`;

    expect(() =>
      configuredOrigins({ ...environment, CONSOLE_API_BASE_URL: withQuery.toString() }),
    ).toThrow(/query/);
    expect(() =>
      configuredOrigins({ ...environment, CONSOLE_API_BASE_URL: withCredentials.toString() }),
    ).toThrow(/credentials/);
    expect(() =>
      configuredOrigins({ ...environment, CONSOLE_EVENTS_URL: wrongPath.toString() }),
    ).toThrow(/versioned protocol path/);
  });

  it.each([
    ['a DNS hostname', 'https://console.example.invalid'],
    ['localhost', 'http://localhost'],
    ['a non-loopback address', 'http://192.0.2.1'],
  ])('rejects %s as a Tauri endpoint', (_description, origin) => {
    const endpoint = new URL(origin);
    endpoint.port = new URL(apiBaseUrl).port;
    endpoint.pathname = '/api/v1';

    expect(() =>
      configuredOrigins({ ...environment, CONSOLE_API_BASE_URL: endpoint.toString() }),
    ).toThrow(/local loopback endpoint/);
  });

  it('accepts an explicit IPv6 loopback endpoint', () => {
    const apiEndpoint = new URL(apiBaseUrl);
    const eventsEndpoint = new URL(eventsUrl);
    apiEndpoint.hostname = '[::1]';
    eventsEndpoint.hostname = '[::1]';

    const origins = configuredOrigins({
      CONSOLE_API_BASE_URL: apiEndpoint.toString(),
      CONSOLE_EVENTS_URL: eventsEndpoint.toString(),
    });
    expect(origins.apiOrigin).toContain('[::1]');
    expect(origins.eventsOrigin).toContain('[::1]');
  });

  it('rejects API and event endpoints on different configured ports', () => {
    const changedPort = new URL(eventsUrl);
    changedPort.port = alternatePort(changedPort);

    expect(() =>
      configuredOrigins({ ...environment, CONSOLE_EVENTS_URL: changedPort.toString() }),
    ).toThrow(/share a host and port/);
  });

  it('refuses to inherit a network source from the base Tauri config', () => {
    const { apiOrigin } = configuredOrigins(environment);
    const unsafeCsp = baseCsp.replace(
      "connect-src 'self' ipc: http://ipc.localhost",
      `connect-src 'self' ipc: ${apiOrigin} http://ipc.localhost`,
    );

    expect(() => createTauriConfigOverlay(unsafeCsp, environment)).toThrow(/host-neutral/);
  });

  it('grants only the runtime configuration application command to the main window', () => {
    expect(mainCapability.windows).toEqual(['main']);
    expect(mainCapability.permissions).toEqual(['allow-get-console-runtime-config']);
  });
});

function directiveSources(csp, directiveName) {
  const directive = csp
    .split(';')
    .map((candidate) => candidate.trim().split(/\s+/))
    .find(([name]) => name === directiveName);
  if (!directive) throw new Error(`${directiveName} is missing from generated CSP`);
  return directive.slice(1);
}

function alternatePort(endpoint) {
  const implicitPort = endpoint.protocol === 'wss:' ? 443 : 80;
  const currentPort = Number(endpoint.port || implicitPort);
  return String(currentPort === 65535 ? 65534 : Math.max(1024, currentPort + 1));
}

function requiredTestEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be injected for console tests`);
  return value;
}
