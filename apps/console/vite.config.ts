import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { isLoopbackHostname } from './src/config/runtime-config';

const CONFIG_ROUTE = '/__console_runtime_config__';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the console development server`);
  }
  return value;
}

export function configuredEndpoint(
  raw: string,
  name: string,
  protocols: readonly string[],
  requiredPath: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} uses an unsupported protocol`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath !== requiredPath) {
    throw new Error(`${name} must end with the versioned protocol path`);
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${name} must target a local loopback endpoint`);
  }
  parsed.pathname = normalizedPath;
  return parsed.toString().replace(/\/$/, '');
}

export function configuredDevHost(raw: string): string {
  const normalized = raw.replace(/^\[|\]$/g, '');
  const hostForParsing = normalized.includes(':') ? `[${normalized}]` : normalized;
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostForParsing}/`);
  } catch {
    throw new Error('CONSOLE_DEV_HOST must be a valid loopback host');
  }
  if (parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('CONSOLE_DEV_HOST must be a loopback host without a port or path');
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error('CONSOLE_DEV_HOST must target a local loopback host');
  }
  return normalized;
}

function developmentRuntimeConfig(): Plugin {
  const apiBaseUrl = configuredEndpoint(
    requiredEnvironment('CONSOLE_API_BASE_URL'),
    'CONSOLE_API_BASE_URL',
    ['http:', 'https:'],
    '/api/v1',
  );
  const eventsUrl = configuredEndpoint(
    requiredEnvironment('CONSOLE_EVENTS_URL'),
    'CONSOLE_EVENTS_URL',
    ['ws:', 'wss:'],
    '/api/v1/events',
  );
  if (new URL(apiBaseUrl).host !== new URL(eventsUrl).host) {
    throw new Error('CONSOLE_API_BASE_URL and CONSOLE_EVENTS_URL must share a host and port');
  }

  return {
    name: 'console-runtime-config',
    configureServer(server) {
      server.middlewares.use(CONFIG_ROUTE, (_request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(
          JSON.stringify({
            schemaVersion: 'console-runtime.v1',
            apiBaseUrl,
            eventsUrl,
            operatorId: requiredEnvironment('CONSOLE_OPERATOR_ID'),
            refreshIntervalMs: requiredEnvironment('CONSOLE_REFRESH_INTERVAL_MS'),
            staleAfterMs: requiredEnvironment('CONSOLE_STALE_AFTER_MS'),
          }),
        );
      });
    },
  };
}

function developmentServer() {
  const host = configuredDevHost(requiredEnvironment('CONSOLE_DEV_HOST'));
  const parsedPort = Number(requiredEnvironment('CONSOLE_DEV_PORT'));
  if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
    throw new Error('CONSOLE_DEV_PORT must be an integer between 1024 and 65535');
  }
  return { host, port: parsedPort, strictPort: true } as const;
}

export default defineConfig(({ command, mode }) => {
  const isDevelopmentServer = command === 'serve' && mode !== 'test';

  return {
    plugins: [react(), ...(isDevelopmentServer ? [developmentRuntimeConfig()] : [])],
    ...(isDevelopmentServer ? { server: developmentServer() } : {}),
    build: {
      sourcemap: true,
    },
    clearScreen: false,
  };
});
