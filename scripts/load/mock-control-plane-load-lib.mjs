import { performance } from 'node:perf_hooks';
import { isIP } from 'node:net';

const REQUIRED_ENVIRONMENT = [
  'LOAD_API_ORIGIN',
  'LOAD_EVENTS_ORIGIN',
  'LOAD_ALLOWED_ORIGIN',
  'LOAD_DEVICE_COUNT',
  'LOAD_WS_CLIENTS',
  'LOAD_WRITE_OPERATIONS',
  'LOAD_CONCURRENCY',
  'LOAD_HEALTH_PROBE_INTERVAL_MS',
  'LOAD_TIMEOUT_MS',
  'LOAD_EVENT_SETTLE_MS',
];

export function loadHarnessConfig(environment = process.env) {
  const missing = REQUIRED_ENVIRONMENT.filter((key) => !environment[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(', ')}`);
  }

  return Object.freeze({
    apiOrigin: parseLocalOrigin(environment.LOAD_API_ORIGIN, 'LOAD_API_ORIGIN', ['http:', 'https:']),
    eventsOrigin: parseLocalOrigin(environment.LOAD_EVENTS_ORIGIN, 'LOAD_EVENTS_ORIGIN', ['ws:', 'wss:']),
    allowedOrigin: parseOrigin(environment.LOAD_ALLOWED_ORIGIN, 'LOAD_ALLOWED_ORIGIN', ['http:', 'https:']),
    deviceCount: boundedInteger(environment.LOAD_DEVICE_COUNT, 'LOAD_DEVICE_COUNT', 32, 64),
    websocketClients: boundedInteger(environment.LOAD_WS_CLIENTS, 'LOAD_WS_CLIENTS', 32, 1000),
    writeOperations: boundedInteger(environment.LOAD_WRITE_OPERATIONS, 'LOAD_WRITE_OPERATIONS', 500, 1000),
    concurrency: boundedInteger(environment.LOAD_CONCURRENCY, 'LOAD_CONCURRENCY', 1, 1000),
    healthProbeIntervalMs: boundedInteger(
      environment.LOAD_HEALTH_PROBE_INTERVAL_MS,
      'LOAD_HEALTH_PROBE_INTERVAL_MS',
      1,
      60000,
    ),
    timeoutMs: boundedInteger(environment.LOAD_TIMEOUT_MS, 'LOAD_TIMEOUT_MS', 1, 600000),
    eventSettleMs: boundedInteger(
      environment.LOAD_EVENT_SETTLE_MS,
      'LOAD_EVENT_SETTLE_MS',
      1,
      600000,
    ),
  });
}

export function buildWritePlan(deviceCount, writeOperations) {
  const remaining = writeOperations - deviceCount;
  if (remaining < 3) {
    throw new Error('LOAD_WRITE_OPERATIONS must leave room for at least one confirmed idempotency group');
  }
  const idempotencyGroups = remaining % 2 === 0 ? 2 : 1;
  const uniqueCommandCount = (remaining - idempotencyGroups * 3) / 2;
  if (!Number.isInteger(uniqueCommandCount) || uniqueCommandCount < 0) {
    throw new Error('cannot construct an exact write plan from the requested counts');
  }
  return Object.freeze({
    registrationRequests: deviceCount,
    uniqueCommandCount,
    idempotencyGroups,
    commandExecutions: uniqueCommandCount + idempotencyGroups,
    totalRequests: deviceCount + uniqueCommandCount * 2 + idempotencyGroups * 3,
  });
}

export function summarizeDeviceSequences(deviceCount, commandResults, finalSnapshotSequences) {
  if (!Number.isInteger(deviceCount) || deviceCount < 1) {
    throw new Error('deviceCount must be a positive integer');
  }
  if (!Array.isArray(finalSnapshotSequences) || finalSnapshotSequences.length !== deviceCount) {
    throw new Error('finalSnapshotSequences must contain one sequence per device');
  }

  const commandsByDevice = Array.from({ length: deviceCount }, () => []);
  for (const command of commandResults) {
    if (!Number.isInteger(command.deviceIndex) || command.deviceIndex < 0 || command.deviceIndex >= deviceCount) {
      throw new Error('command result contains an invalid device index');
    }
    const sequences = command.responses.map((response) => response.sequence);
    if (sequences.length < 1 || !sequences.every((sequence) => Number.isInteger(sequence) && sequence >= 2)) {
      throw new Error('command result contains an invalid response sequence');
    }
    commandsByDevice[command.deviceIndex].push(sequences);
  }

  const perDevice = commandsByDevice.map((commandGroups, deviceIndex) => {
    const uniqueSequences = commandGroups.map((sequences) => sequences[0]).sort((left, right) => left - right);
    const duplicateResponsesAgree = commandGroups.every((sequences) => sequences.every((sequence) => sequence === sequences[0]));
    const expectedSequences = Array.from(
      { length: uniqueSequences.length },
      (_, index) => index + 2,
    );
    const responseSequencesContiguous = equalNumbers(uniqueSequences, expectedSequences);
    const finalSnapshotSequence = finalSnapshotSequences[deviceIndex];
    const expectedFinalSequence = uniqueSequences.length + 1;
    const finalSnapshotMatches = finalSnapshotSequence === expectedFinalSequence;
    return {
      device_index: deviceIndex + 1,
      unique_command_executions: uniqueSequences.length,
      response_sequence_start: uniqueSequences.length === 0 ? null : 2,
      response_sequence_end: uniqueSequences.length === 0 ? null : expectedFinalSequence,
      final_snapshot_sequence: finalSnapshotSequence,
      duplicate_responses_agree: duplicateResponsesAgree,
      response_sequences_contiguous: responseSequencesContiguous,
      final_snapshot_matches: finalSnapshotMatches,
      passed: duplicateResponsesAgree && responseSequencesContiguous && finalSnapshotMatches,
    };
  });
  return {
    devices: perDevice,
    unique_command_executions: commandResults.length,
    passed: perDevice.every((device) => device.passed),
  };
}

export function percentile(samples, requestedPercentile) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const position = Math.ceil((requestedPercentile / 100) * sorted.length) - 1;
  return roundMilliseconds(sorted[Math.max(0, Math.min(position, sorted.length - 1))]);
}

export function latencySummary(samples) {
  return {
    count: samples.length,
    p50_ms: percentile(samples, 50),
    p95_ms: percentile(samples, 95),
    p99_ms: percentile(samples, 99),
    max_ms: samples.length === 0 ? null : roundMilliseconds(Math.max(...samples)),
  };
}

export function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

export async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await operation(items[currentIndex], currentIndex);
      }
    }),
  );
  return results;
}

export function elapsedMs(startedAt) {
  return roundMilliseconds(performance.now() - startedAt);
}

function parseOrigin(value, name, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL origin`);
  }
  if (!protocols.includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error(`${name} must be a credential-free ${protocols.join(' or ')} origin without a path`);
  }
  return parsed.origin;
}

function parseLocalOrigin(value, name, protocols) {
  const origin = parseOrigin(value, name, protocols);
  const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
  const octets = hostname.split('.');
  const isLoopbackV4 = isIP(hostname) === 4 && octets.length === 4 && Number(octets[0]) === 0x7f;
  if (!isLoopbackV4) {
    throw new Error(`${name} must target a local loopback origin`);
  }
  return origin;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function equalNumbers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
