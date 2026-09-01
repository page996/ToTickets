export interface ConsoleRuntimeConfig {
  readonly schemaVersion: 'console-runtime.v1';
  readonly apiBaseUrl: string;
  readonly eventsUrl: string;
  readonly operatorId: string;
  readonly refreshIntervalMs: number;
  readonly staleAfterMs: number;
}

type JsonRecord = Record<string, unknown>;

declare global {
  interface Window {
    __CONSOLE_RUNTIME_CONFIG__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, maximumLength = 2048): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) {
    throw new Error(`${name} is too long`);
  }
  return trimmed;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function validatedOperatorId(value: unknown): string {
  const operatorId = requiredString(value, 'operatorId', 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(operatorId)) {
    throw new Error('operatorId may contain only letters, numbers, dot, underscore, colon, and hyphen');
  }
  return operatorId;
}

/**
 * The console is intentionally local-only until authentication, TLS, RBAC, and
 * CSRF controls are shipped. URL parsing canonicalizes IPv4/IPv6 spellings, so
 * checking the parsed hostname also rejects DNS names and non-loopback aliases.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4Octets = normalized.split('.');
  if (
    ipv4Octets.length === 4 &&
    ipv4Octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  ) {
    return Number(ipv4Octets[0]) === 127;
  }

  // URL canonicalization reduces every spelling of the IPv6 loopback address
  // to three segments: an empty compressed prefix and a final `1` segment.
  const ipv6Segments = normalized.split(':');
  return (
    ipv6Segments.length === 3 &&
    ipv6Segments[0] === '' &&
    ipv6Segments[1] === '' &&
    ipv6Segments[2] === '1'
  );
}

function assertOnlyKeys(record: JsonRecord, allowed: readonly string[]): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`runtime configuration contains unknown keys: ${unknown.join(', ')}`);
  }
}

function validatedEndpoint(
  value: unknown,
  name: string,
  protocols: readonly string[],
  requiredPath: string,
): string {
  const raw = requiredString(value, name);
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
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${name} must target a local loopback endpoint`);
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath !== requiredPath) {
    throw new Error(`${name} must end with the versioned protocol path`);
  }
  parsed.pathname = normalizedPath;
  return parsed.toString().replace(/\/$/, '');
}

export function parseRuntimeConfig(candidate: unknown): ConsoleRuntimeConfig {
  if (!isRecord(candidate)) {
    throw new Error('runtime configuration must be an object');
  }
  assertOnlyKeys(candidate, [
    'schemaVersion',
    'apiBaseUrl',
    'eventsUrl',
    'operatorId',
    'refreshIntervalMs',
    'staleAfterMs',
  ]);
  if (candidate.schemaVersion !== 'console-runtime.v1') {
    throw new Error('runtime configuration schema is not supported');
  }
  const refreshIntervalMs = boundedInteger(
    candidate.refreshIntervalMs,
    'refreshIntervalMs',
    500,
    60_000,
  );
  const staleAfterMs = boundedInteger(candidate.staleAfterMs, 'staleAfterMs', 1_000, 600_000);
  if (staleAfterMs < refreshIntervalMs) {
    throw new Error('staleAfterMs must not be shorter than refreshIntervalMs');
  }
  const apiBaseUrl = validatedEndpoint(
    candidate.apiBaseUrl,
    'apiBaseUrl',
    ['http:', 'https:'],
    '/api/v1',
  );
  const eventsUrl = validatedEndpoint(
    candidate.eventsUrl,
    'eventsUrl',
    ['ws:', 'wss:'],
    '/api/v1/events',
  );
  if (new URL(apiBaseUrl).host !== new URL(eventsUrl).host) {
    throw new Error('apiBaseUrl and eventsUrl must target the same configured host and port');
  }
  return Object.freeze({
    schemaVersion: 'console-runtime.v1',
    apiBaseUrl,
    eventsUrl,
    operatorId: validatedOperatorId(candidate.operatorId),
    refreshIntervalMs,
    staleAfterMs,
  });
}

async function readRuntimeCandidate(): Promise<unknown> {
  if (window.__CONSOLE_RUNTIME_CONFIG__ !== undefined) {
    return window.__CONSOLE_RUNTIME_CONFIG__;
  }
  if (window.__TAURI_INTERNALS__ !== undefined) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<unknown>('get_console_runtime_config');
  }
  const response = await fetch('/__console_runtime_config__', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('development runtime configuration is unavailable');
  }
  return response.json();
}

export async function loadRuntimeConfig(): Promise<ConsoleRuntimeConfig> {
  return parseRuntimeConfig(await readRuntimeCandidate());
}
