import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIRECTORY = dirname(SCRIPT_DIRECTORY);
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const BASE_CONFIG_SEGMENTS = ['src-tauri', 'tauri.conf.json'];
const GENERATED_CONFIG_SEGMENTS = ['.runtime', 'tauri.generated.conf.json'];
const API_PROTOCOL_PATH = '/api/v1';
const EVENTS_PROTOCOL_PATH = '/api/v1/events';
const HOST_NEUTRAL_CONNECT_SOURCES = new Set(["'self'", 'ipc:']);

function isLoopbackHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4Octets = normalized.split('.');
  if (
    ipv4Octets.length === 4 &&
    ipv4Octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  ) {
    return Number(ipv4Octets[0]) === 127;
  }

  const ipv6Segments = normalized.split(':');
  return (
    ipv6Segments.length === 3 &&
    ipv6Segments[0] === '' &&
    ipv6Segments[1] === '' &&
    ipv6Segments[2] === '1'
  );
}

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to generate the Tauri CSP overlay`);
  }
  return value;
}

function configuredEndpoint(raw, name, allowedProtocols, requiredPath) {
  if (raw.length > 2048) {
    throw new Error(`${name} is too long`);
  }

  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (!allowedProtocols.includes(endpoint.protocol)) {
    throw new Error(`${name} uses an unsupported protocol`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment`);
  }
  if (!isLoopbackHostname(endpoint.hostname)) {
    throw new Error(`${name} must target a local loopback endpoint`);
  }

  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
  if (normalizedPath !== requiredPath) {
    throw new Error(`${name} must end with the versioned protocol path`);
  }

  return endpoint;
}

export function configuredOrigins(environment) {
  const apiEndpoint = configuredEndpoint(
    requiredEnvironment(environment, 'CONSOLE_API_BASE_URL'),
    'CONSOLE_API_BASE_URL',
    ['http:', 'https:'],
    API_PROTOCOL_PATH,
  );
  const eventsEndpoint = configuredEndpoint(
    requiredEnvironment(environment, 'CONSOLE_EVENTS_URL'),
    'CONSOLE_EVENTS_URL',
    ['ws:', 'wss:'],
    EVENTS_PROTOCOL_PATH,
  );

  if (apiEndpoint.host !== eventsEndpoint.host) {
    throw new Error('CONSOLE_API_BASE_URL and CONSOLE_EVENTS_URL must share a host and port');
  }

  return Object.freeze({
    apiOrigin: apiEndpoint.origin,
    eventsOrigin: eventsEndpoint.origin,
  });
}

function parsedCspDirectives(baseCsp) {
  if (typeof baseCsp !== 'string' || baseCsp.trim().length === 0) {
    throw new Error('app.security.csp must be a non-empty string in the base Tauri config');
  }

  const directives = baseCsp
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => directive.split(/\s+/));

  const names = new Set();
  for (const [name] of directives) {
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) {
      throw new Error(`base Tauri CSP contains duplicate ${normalizedName} directives`);
    }
    names.add(normalizedName);
  }

  return directives;
}

export function createTauriConfigOverlay(baseCsp, environment) {
  const origins = configuredOrigins(environment);
  const directives = parsedCspDirectives(baseCsp);
  const connectDirective = directives.find(([name]) => name.toLowerCase() === 'connect-src');

  if (!connectDirective) {
    throw new Error('base Tauri CSP must define a host-neutral connect-src directive');
  }

  const baseSources = connectDirective.slice(1);
  if (
    baseSources.length === 0 ||
    baseSources.some((source) => !HOST_NEUTRAL_CONNECT_SOURCES.has(source))
  ) {
    throw new Error("base Tauri connect-src must remain host-neutral with only 'self' and ipc:");
  }

  const generatedSources = [...new Set([...baseSources, origins.apiOrigin, origins.eventsOrigin])];
  const csp = directives
    .map((directive) => {
      if (directive[0].toLowerCase() !== 'connect-src') {
        return directive.join(' ');
      }
      return ['connect-src', ...generatedSources].join(' ');
    })
    .join('; ');

  return Object.freeze({
    app: Object.freeze({
      security: Object.freeze({ csp }),
    }),
  });
}

async function workspaceRoot(startDirectory) {
  let current = resolve(startDirectory);

  while (true) {
    const marker = join(current, WORKSPACE_MARKER);
    try {
      if ((await stat(marker)).isFile()) {
        return current;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`unable to locate ${WORKSPACE_MARKER} above the console package`);
    }
    current = parent;
  }
}

async function readBaseCsp(baseConfigPath) {
  let baseConfig;
  try {
    baseConfig = JSON.parse(await readFile(baseConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(`unable to read the base Tauri config: ${error.message}`);
  }
  return baseConfig?.app?.security?.csp;
}

export async function generateTauriConfigOverlay(environment = process.env) {
  const root = await workspaceRoot(CONSOLE_DIRECTORY);
  const baseConfigPath = join(CONSOLE_DIRECTORY, ...BASE_CONFIG_SEGMENTS);
  const outputPath = join(root, ...GENERATED_CONFIG_SEGMENTS);
  const overlay = createTauriConfigOverlay(await readBaseCsp(baseConfigPath), environment);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(overlay, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return Object.freeze({ outputPath, overlay });
}
