import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import {
  buildWritePlan,
  latencySummary,
  loadHarnessConfig,
  mapWithConcurrency,
  summarizeDeviceSequences,
} from './mock-control-plane-load-lib.mjs';

const testPort = randomInt(1024, 65536);
const loopbackHost = [0x7f, 0, 0, 1].join('.');
const loopbackOrigin = (protocol) => `${protocol}://${loopbackHost}:${testPort}`;
const allowedOrigin = `http:${String.fromCharCode(47, 47)}console-${randomUUID()}.invalid`;
const environment = {
  LOAD_API_ORIGIN: loopbackOrigin('http'),
  LOAD_EVENTS_ORIGIN: loopbackOrigin('ws'),
  LOAD_ALLOWED_ORIGIN: allowedOrigin,
  LOAD_DEVICE_COUNT: '32',
  LOAD_WS_CLIENTS: '32',
  LOAD_WRITE_OPERATIONS: '500',
  LOAD_CONCURRENCY: '8',
  LOAD_HEALTH_PROBE_INTERVAL_MS: '25',
  LOAD_TIMEOUT_MS: '1000',
  LOAD_EVENT_SETTLE_MS: '1000',
};

const config = loadHarnessConfig(environment);
assert.equal(config.deviceCount, 32);
assert.throws(() => loadHarnessConfig({ ...environment, LOAD_API_ORIGIN: 'not-a-url' }), /LOAD_API_ORIGIN/);
assert.throws(() => loadHarnessConfig({ ...environment, LOAD_API_ORIGIN: `http://${randomUUID()}.invalid` }), /local loopback/);
assert.throws(() => loadHarnessConfig({ ...environment, LOAD_WRITE_OPERATIONS: '499' }), /between 500 and 1000/);

for (const requestedWrites of [500, 501, 1000]) {
  const plan = buildWritePlan(config.deviceCount, requestedWrites);
  assert.equal(plan.totalRequests, requestedWrites);
  assert.ok(plan.idempotencyGroups >= 1);
}

assert.deepEqual(latencySummary([1, 2, 3, 4]), {
  count: 4,
  p50_ms: 2,
  p95_ms: 4,
  p99_ms: 4,
  max_ms: 4,
});

const sequenceAggregate = summarizeDeviceSequences(3, [
  { deviceIndex: 0, responses: [{ sequence: 2 }] },
  { deviceIndex: 0, responses: [{ sequence: 3 }, { sequence: 3 }] },
  { deviceIndex: 1, responses: [{ sequence: 2 }] },
], [3, 2, 1]);
assert.equal(sequenceAggregate.passed, true);
assert.deepEqual(sequenceAggregate.devices, [
  {
    device_index: 1,
    unique_command_executions: 2,
    response_sequence_start: 2,
    response_sequence_end: 3,
    final_snapshot_sequence: 3,
    duplicate_responses_agree: true,
    response_sequences_contiguous: true,
    final_snapshot_matches: true,
    passed: true,
  },
  {
    device_index: 2,
    unique_command_executions: 1,
    response_sequence_start: 2,
    response_sequence_end: 2,
    final_snapshot_sequence: 2,
    duplicate_responses_agree: true,
    response_sequences_contiguous: true,
    final_snapshot_matches: true,
    passed: true,
  },
  {
    device_index: 3,
    unique_command_executions: 0,
    response_sequence_start: null,
    response_sequence_end: null,
    final_snapshot_sequence: 1,
    duplicate_responses_agree: true,
    response_sequences_contiguous: true,
    final_snapshot_matches: true,
    passed: true,
  },
]);
assert.equal(
  summarizeDeviceSequences(1, [{ deviceIndex: 0, responses: [{ sequence: 3 }] }], [3]).passed,
  false,
);
assert.equal(
  summarizeDeviceSequences(1, [{ deviceIndex: 0, responses: [{ sequence: 2 }, { sequence: 3 }] }], [2]).passed,
  false,
);

const observed = [];
await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => { observed.push(value); return value * 2; });
assert.deepEqual(observed.sort(), [1, 2, 3, 4]);

process.stdout.write('mock-control-plane load harness self-test passed\n');
