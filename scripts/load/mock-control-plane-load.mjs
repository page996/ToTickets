import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import {
  buildWritePlan,
  elapsedMs,
  latencySummary,
  loadHarnessConfig,
  mapWithConcurrency,
  roundMilliseconds,
  summarizeDeviceSequences,
} from './mock-control-plane-load-lib.mjs';

const EVENTS_PATH = '/api/v1/events';
const API_PREFIX = '/api/v1';

async function main() {
  const startedAt = performance.now();
  let report = createReport(null);
  const clients = [];
  let stopHealthProbes = () => undefined;

  try {
    const config = loadHarnessConfig();
    report = createReport(config);
    const plan = buildWritePlan(config.deviceCount, config.writeOperations);
    report.workload.write_plan = toSnakeCasePlan(plan);
    const preflightDiagnostics = await preflight(config, report);
    const baselineSequence = preflightDiagnostics.resources.event_bus.current_sequence;
    const deviceIds = await registerDevices(config, plan, report);
    await connectClients(config, baselineSequence, report, clients);
    await waitForClientEvents(clients, config.deviceCount, config.timeoutMs);

    stopHealthProbes = startHealthProbes(config, report);
    const commandResults = await executeWritePlan(config, deviceIds, plan, report);
    await verifyDeviceSnapshots(config, deviceIds, commandResults, report);
    await probeHealth(config, report);

    const expectedEventsPerClient = config.deviceCount + plan.commandExecutions;
    await waitForClientEvents(clients, expectedEventsPerClient, config.eventSettleMs);
    report.events.fanout = summarizeFanout(clients, expectedEventsPerClient);
    await verifyCursorRecovery(config, clients, report);

    const finalDiagnostics = await getDiagnostics(config, report);
    report.events.server = {
      delivery_errors: finalDiagnostics.resources.event_bus.delivery_errors,
      rejected_connections: finalDiagnostics.resources.websocket.rejected_connections,
      slow_client_closures: finalDiagnostics.resources.websocket.slow_client_closures,
      send_failures: finalDiagnostics.resources.websocket.send_failures,
    };
    verifyResults(report, plan, clients);
  } catch (error) {
    report.status = 'failed';
    report.failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    stopHealthProbes();
    await Promise.allSettled(clients.map((client) => client.close()));
    finalizeMetrics(report);
    report.duration_ms = elapsedMs(startedAt);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

function createReport(config) {
  return {
    schema: 'mock-control-plane-load-report.v1',
    status: 'passed',
    generated_at: new Date().toISOString(),
    scope: {
      adapter: 'mock-adapter',
      device_input: false,
      real_platform_access: false,
      external_network_access: false,
    },
    configuration: config ? {
      device_count: config.deviceCount,
      websocket_clients: config.websocketClients,
      write_operations: config.writeOperations,
      concurrency: config.concurrency,
      health_probe_interval_ms: config.healthProbeIntervalMs,
      timeout_ms: config.timeoutMs,
      event_settle_ms: config.eventSettleMs,
    } : null,
    workload: {
      write_plan: null,
      requests: { attempted: 0, successful: 0, failed: 0, latency_ms: [] },
      per_device: null,
    },
    health: { probes: 0, failures: 0, ready_degraded_responses: 0, live_latency_ms: [], ready_latency_ms: [], diagnostics_latency_ms: [] },
    events: {
      clients_connected: 0,
      client_connection_failures: 0,
      sync_frames: 0,
      event_frames: 0,
      malformed_frames: 0,
      fanout: null,
      recovery: { cursor_replay_attempted: 0, cursor_replay_successful: 0, reset_fault_attempted: 0, reset_fault_observed: 0, latency_ms: [] },
      server: null,
      slow_client_coverage: 'Not exercised by this harness; covered by the existing EventsGateway backpressure unit tests.',
    },
    assertions: [],
    failures: [],
    duration_ms: null,
  };
}

async function preflight(config, report) {
  await probeHealth(config, report);
  const diagnostics = await getDiagnostics(config, report);
  const resources = diagnostics.resources;
  if (resources.devices.available < config.deviceCount) {
    throw new Error('preflight failed: configured device capacity cannot accommodate LOAD_DEVICE_COUNT');
  }
  if (resources.websocket.clients.available < config.websocketClients) {
    throw new Error('preflight failed: configured WebSocket capacity cannot accommodate LOAD_WS_CLIENTS');
  }
  if (resources.event_history.max < config.deviceCount) {
    throw new Error('preflight failed: event history capacity is smaller than LOAD_DEVICE_COUNT');
  }
  if (resources.event_history.max < config.writeOperations) {
    throw new Error('preflight failed: event history capacity is smaller than LOAD_WRITE_OPERATIONS');
  }
  const expectedConcurrentCommands = Math.min(config.concurrency, buildWritePlan(config.deviceCount, config.writeOperations).commandExecutions);
  if (resources.confirmations.available < expectedConcurrentCommands) {
    throw new Error('preflight failed: confirmation ticket capacity cannot accommodate the requested concurrency');
  }
  return diagnostics;
}

async function registerDevices(config, plan, report) {
  const aliases = Array.from({ length: plan.registrationRequests }, (_, index) => index);
  const responses = await mapWithConcurrency(aliases, config.concurrency, async (index) => {
    const response = await writeJson(config, report, '/devices', {
      alias: `Load mock ${String(index + 1).padStart(2, '0')}`,
      provider: 'mock-adapter',
      transport: 'memory',
      group: 'load-harness',
    }, `load-${randomUUID()}-register-${index}`);
    return response.body;
  });
  return responses.map((body) => body.id);
}

async function connectClients(config, since, report, clients) {
  const opened = await mapWithConcurrency(
    Array.from({ length: config.websocketClients }),
    config.concurrency,
    async () => {
      try {
        const client = await EventClient.connect(eventUrl(config, { since }), config.allowedOrigin, config.timeoutMs, report);
        clients.push(client);
        report.events.clients_connected += 1;
        return client;
      } catch (error) {
        report.events.client_connection_failures += 1;
        throw error;
      }
    },
  );
  await Promise.all(opened.map((client) => client.waitForSync(config.timeoutMs)));
  return opened;
}

async function executeWritePlan(config, deviceIds, plan, report) {
  const normalCommands = Array.from({ length: plan.uniqueCommandCount }, (_, index) => ({
    deviceId: deviceIds[index % deviceIds.length],
    deviceIndex: index % deviceIds.length,
    idempotencyKey: `load-${randomUUID()}-reconnect-${index}`,
    duplicate: false,
  }));
  const duplicateCommands = Array.from({ length: plan.idempotencyGroups }, (_, index) => ({
    deviceId: deviceIds[index % deviceIds.length],
    deviceIndex: index % deviceIds.length,
    idempotencyKey: `load-${randomUUID()}-same-key-${index}`,
    duplicate: true,
  }));
  const commandsByDevice = Array.from({ length: deviceIds.length }, () => []);
  for (const command of [...normalCommands, ...duplicateCommands]) {
    commandsByDevice[command.deviceIndex].push(command);
  }
  const groupedResults = await mapWithConcurrency(
    commandsByDevice.filter((commands) => commands.length > 0),
    config.concurrency,
    async (commands) => {
      const deviceResults = [];
      for (const command of commands) {
        deviceResults.push(await runConfirmedReconnect(config, report, command));
      }
      return deviceResults;
    },
  );
  const results = groupedResults.flat();
  const duplicateResults = results.filter((result) => result.duplicate);
  for (const result of duplicateResults) {
    if (result.responses.length !== 2 || result.responses[0].sequence !== result.responses[1].sequence) {
      throw new Error('idempotency verification failed: duplicate command responses diverged');
    }
  }
  report.assertions.push({
    name: 'same_idempotency_key_executes_once',
    expected_groups: plan.idempotencyGroups,
    verified_groups: duplicateResults.length,
    passed: duplicateResults.length === plan.idempotencyGroups,
  });
  return results;
}

async function runConfirmedReconnect(config, report, command) {
  const snapshot = await readJson(
    config,
    `/devices/${command.deviceId}`,
    config.timeoutMs,
  );
  const expectedSequence = snapshot.body.sequence;
  const confirmation = await writeJson(config, report, '/safety/confirmations', {
    operator_id: 'load-harness',
    device_id: command.deviceId,
    intent: 'device.reconnect',
    expected_sequence: expectedSequence,
    confirmed: true,
  }, `load-${randomUUID()}-confirmation`);
  const payload = {
    operator_id: 'load-harness',
    confirmation_id: confirmation.body.confirmation_id,
    intent: 'device.reconnect',
    expected_sequence: expectedSequence,
  };
  const path = `/devices/${command.deviceId}/commands/reconnect`;
  const responseCount = command.duplicate ? 2 : 1;
  const responses = await Promise.all(
    Array.from({ length: responseCount }, () => writeJson(config, report, path, payload, command.idempotencyKey)),
  );
  return {
    deviceIndex: command.deviceIndex,
    duplicate: command.duplicate,
    responses: responses.map((response) => response.body),
  };
}

async function verifyDeviceSnapshots(config, deviceIds, commandResults, report) {
  const snapshots = await mapWithConcurrency(deviceIds, config.concurrency, async (deviceId) => {
    const response = await readJson(config, `/devices/${deviceId}`, config.timeoutMs);
    return response.body.sequence;
  });
  const aggregate = summarizeDeviceSequences(deviceIds.length, commandResults, snapshots);
  report.workload.per_device = aggregate.devices;
  report.assertions.push({
    name: 'per_device_sequence_and_final_snapshot',
    expected_devices: deviceIds.length,
    verified_devices: aggregate.devices.filter((device) => device.passed).length,
    passed: aggregate.passed,
  });
  if (!aggregate.passed) {
    throw new Error('per-device response sequences or final snapshots did not match unique command executions');
  }
}

function startHealthProbes(config, report) {
  let stopped = false;
  let active = false;
  const timer = setInterval(() => {
    if (stopped || active) return;
    active = true;
    void probeHealth(config, report).catch((error) => {
      report.health.failures += 1;
      report.failures.push(`health probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { active = false; });
  }, config.healthProbeIntervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function probeHealth(config, report) {
  const [live, ready] = await Promise.all([
    readJson(config, '/health/live', config.timeoutMs),
    readJson(config, '/health/ready', config.timeoutMs),
  ]);
  report.health.probes += 1;
  report.health.live_latency_ms.push(live.latencyMs);
  report.health.ready_latency_ms.push(ready.latencyMs);
  if (live.body.status !== 'ok') {
    throw new Error('health live probe returned a non-ok status');
  }
  if (!['ok', 'degraded'].includes(ready.body.status)) {
    throw new Error('health ready probe returned an unknown status');
  }
  if (ready.body.status === 'degraded') report.health.ready_degraded_responses += 1;
}

async function getDiagnostics(config, report) {
  const diagnostics = await readJson(config, '/health/diagnostics', config.timeoutMs);
  report.health.probes += 1;
  report.health.diagnostics_latency_ms.push(diagnostics.latencyMs);
  return diagnostics.body;
}

async function verifyCursorRecovery(config, clients, report) {
  const source = clients[0];
  const sync = source.sync;
  const latestSequence = Math.max(...source.events.map((event) => event.data.sequence));

  report.events.recovery.reset_fault_attempted += 1;
  const resetStartedAt = performance.now();
  const resetClient = await EventClient.connect(
    eventUrl(config, { since: latestSequence + 1, streamId: sync.stream_id }),
    config.allowedOrigin,
    config.timeoutMs,
    report,
  );
  try {
    const resetSync = await resetClient.waitForSync(config.timeoutMs);
    report.events.recovery.latency_ms.push(elapsedMs(resetStartedAt));
    if (resetSync.reset_required === true) report.events.recovery.reset_fault_observed += 1;
  } finally {
    await resetClient.close();
  }

  report.events.recovery.cursor_replay_attempted += 1;
  const replayStartedAt = performance.now();
  const recoveryClient = await EventClient.connect(
    eventUrl(config, { since: latestSequence - 1, streamId: sync.stream_id }),
    config.allowedOrigin,
    config.timeoutMs,
    report,
  );
  try {
    const recoverySync = await recoveryClient.waitForSync(config.timeoutMs);
    await recoveryClient.waitForEvents(1, config.timeoutMs);
    report.events.recovery.latency_ms.push(elapsedMs(replayStartedAt));
    if (!recoverySync.reset_required && recoveryClient.events.some((event) => event.data.sequence === latestSequence)) {
      report.events.recovery.cursor_replay_successful += 1;
    }
  } finally {
    await recoveryClient.close();
  }
}

function verifyResults(report, plan, clients) {
  const passed = [
    ['write_operation_count', report.workload.requests.attempted === plan.totalRequests],
    ['all_write_operations_succeeded', report.workload.requests.failed === 0],
    ['health_probes_responded', report.health.failures === 0 && report.health.probes > 0],
    ['websocket_fanout', report.events.fanout.complete_clients === clients.length],
    ['cursor_reset_fault', report.events.recovery.reset_fault_observed === 1],
    ['cursor_replay', report.events.recovery.cursor_replay_successful === 1],
  ];
  for (const [name, result] of passed) report.assertions.push({ name, passed: result });
  if (passed.some(([, result]) => !result)) {
    throw new Error('one or more load assertions failed; see assertions in the report');
  }
}

function finalizeMetrics(report) {
  if (report.workload.requests.latency_ms) {
    report.workload.requests.latency = latencySummary(report.workload.requests.latency_ms);
    report.workload.requests.error_rate = rate(report.workload.requests.failed, report.workload.requests.attempted);
    delete report.workload.requests.latency_ms;
  }
  if (report.health.live_latency_ms) {
    const allHealthLatencies = [
      ...report.health.live_latency_ms,
      ...report.health.ready_latency_ms,
      ...report.health.diagnostics_latency_ms,
    ];
    report.health.latency = {
      live: latencySummary(report.health.live_latency_ms),
      ready: latencySummary(report.health.ready_latency_ms),
      diagnostics: latencySummary(report.health.diagnostics_latency_ms),
      maximum_ms: allHealthLatencies.length === 0 ? null : roundMilliseconds(Math.max(...allHealthLatencies)),
    };
    delete report.health.live_latency_ms;
    delete report.health.ready_latency_ms;
    delete report.health.diagnostics_latency_ms;
  }
  if (report.events.recovery.latency_ms) {
    report.events.recovery.latency = latencySummary(report.events.recovery.latency_ms);
    delete report.events.recovery.latency_ms;
  }
}

function summarizeFanout(clients, expectedEventsPerClient) {
  const completeClients = clients.filter((client) => client.events.length >= expectedEventsPerClient).length;
  return {
    expected_events_per_client: expectedEventsPerClient,
    minimum_events_per_client: Math.min(...clients.map((client) => client.events.length)),
    maximum_events_per_client: Math.max(...clients.map((client) => client.events.length)),
    complete_clients: completeClients,
  };
}

async function waitForClientEvents(clients, expectedCount, timeoutMs) {
  await Promise.all(clients.map((client) => client.waitForEvents(expectedCount, timeoutMs)));
}

async function writeJson(config, report, path, payload, idempotencyKey) {
  const startedAt = performance.now();
  report.workload.requests.attempted += 1;
  try {
    const response = await fetchWithTimeout(apiUrl(config, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'x-operator-id': 'load-harness',
      },
      body: JSON.stringify(payload),
    }, config.timeoutMs);
    const body = await response.json();
    if (!response.ok) throw new Error(`POST ${path} returned ${response.status}: ${body.code ?? 'unknown'}`);
    report.workload.requests.successful += 1;
    report.workload.requests.latency_ms.push(elapsedMs(startedAt));
    return { body, latencyMs: elapsedMs(startedAt) };
  } catch (error) {
    report.workload.requests.failed += 1;
    report.workload.requests.latency_ms.push(elapsedMs(startedAt));
    throw error;
  }
}

async function readJson(config, path, timeoutMs) {
  const startedAt = performance.now();
  const response = await fetchWithTimeout(apiUrl(config, path), { headers: { 'x-operator-id': 'load-harness' } }, timeoutMs);
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return { body, latencyMs: elapsedMs(startedAt) };
}

function apiUrl(config, path) {
  return new URL(`${API_PREFIX}${path}`, `${config.apiOrigin}/`).toString();
}

function eventUrl(config, cursor) {
  const url = new URL(EVENTS_PATH, `${config.eventsOrigin}/`);
  url.searchParams.set('since', String(cursor.since));
  if (cursor.streamId) url.searchParams.set('stream_id', cursor.streamId);
  return url.toString();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class EventClient {
  constructor(socket, report) {
    this.socket = socket;
    this.report = report;
    this.events = [];
    this.sync = null;
    this.closed = false;
    this.waiters = [];
    socket.on('message', (frame) => this.onMessage(frame));
    socket.on('close', () => { this.closed = true; this.notify(); });
    socket.on('error', () => { this.closed = true; this.notify(); });
  }

  static connect(url, origin, timeoutMs, report) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { origin });
      const client = new EventClient(socket, report);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error('WebSocket connection timed out'));
      }, timeoutMs);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve(client);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  onMessage(frame) {
    let parsed;
    try {
      parsed = JSON.parse(frame.toString());
    } catch {
      this.report.events.malformed_frames += 1;
      this.notify();
      return;
    }
    if (parsed.protocol === 'event-stream.sync.v1') {
      this.sync = parsed;
      this.report.events.sync_frames += 1;
    } else if (typeof parsed?.data?.sequence === 'number') {
      this.events.push(parsed);
      this.report.events.event_frames += 1;
    } else {
      this.report.events.malformed_frames += 1;
    }
    this.notify();
  }

  waitForSync(timeoutMs) {
    return this.waitFor(() => this.sync !== null, timeoutMs, 'WebSocket sync frame');
  }

  waitForEvents(count, timeoutMs) {
    return this.waitFor(() => this.events.length >= count, timeoutMs, `at least ${count} WebSocket events`);
  }

  waitFor(condition, timeoutMs, description) {
    if (condition()) return Promise.resolve(this.sync);
    if (this.closed) return Promise.reject(new Error(`WebSocket closed before ${description}`));
    return new Promise((resolve, reject) => {
      const waiter = { condition, resolve, reject, description, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        reject(new Error(`timed out waiting for ${description}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  notify() {
    for (const waiter of [...this.waiters]) {
      if (waiter.condition()) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        waiter.resolve(this.sync);
      } else if (this.closed) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        waiter.reject(new Error(`WebSocket closed before ${waiter.description}`));
      }
    }
  }

  close() {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once('close', resolve);
      this.socket.close();
    });
  }
}

function toSnakeCasePlan(plan) {
  return {
    registration_requests: plan.registrationRequests,
    unique_command_count: plan.uniqueCommandCount,
    idempotency_groups: plan.idempotencyGroups,
    command_executions: plan.commandExecutions,
    total_requests: plan.totalRequests,
  };
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

void main();
