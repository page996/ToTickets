import {
  FORBIDDEN_HELPER_CAPABILITIES,
  SAFE_HELPER_CAPABILITIES,
  SYSTEM_HELPER_MANIFEST_SCHEMA,
  HelperActivationPlan,
  HelperActivationRequest,
  HelperCapability,
  HelperPathRef,
  SystemHelperEntry,
  SystemHelperManifest,
} from './helper-manifest.types';

type JsonRecord = Record<string, unknown>;

const MANIFEST_KEY_SET = ['schema_version', 'manifest_id', 'entries'] as const;
const ENTRY_KEY_SET = [
  'helper_id',
  'state',
  'purpose',
  'artifact',
  'approval',
  'capabilities',
  'invocation',
  'data_policy',
  'resource_limits',
  'lifecycle',
  'audit',
  'revocation',
] as const;
const ARTIFACT_KEY_SET = ['path_ref', 'version', 'sha256', 'source_url', 'license', 'maintenance'] as const;
const APPROVAL_KEY_SET = ['approved_by', 'approved_at_utc'] as const;
const CAPABILITIES_KEY_SET = ['allow', 'deny'] as const;
const INVOCATION_KEY_SET = [
  'allowed_operations',
  'allowed_environment_keys',
  'working_directory',
  'network_access',
  'max_runtime_ms',
  'max_output_bytes',
  'max_child_processes',
] as const;
const DATA_POLICY_KEY_SET = ['read_scopes', 'write_scopes', 'sensitive_data'] as const;
const RESOURCE_LIMIT_KEY_SET = ['cpu_seconds', 'memory_mib', 'disk_mib'] as const;
const LIFECYCLE_KEY_SET = ['start', 'health', 'stop', 'crash_recovery'] as const;
const AUDIT_KEY_SET = ['event_type', 'checkpoint_id'] as const;
const REVOCATION_KEY_SET = ['action', 'owner'] as const;

const SAFE_CAPABILITY_SET = new Set<HelperCapability>(SAFE_HELPER_CAPABILITIES);
const SECRET_KEY_PATTERN = /(?:SECRET|TOKEN|PASSWORD|PASSWD|COOKIE|OTP|PAYMENT|CREDENTIAL|PRIVATE_KEY)/i;
const SHELL_METACHARACTER_PATTERN = /[;&|<>$`\\()[\]{}\r\n]/;
const PATH_REF_PATTERN = /^(env|project|selection):[A-Z][A-Z0-9_]{1,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,63}$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SCOPE_PATTERN = /^(project|selection):(?!.{0,128}\.\.)[A-Za-z0-9._/-]{1,120}$/;
const CHECKPOINT_PATTERN = /^CP-[0-9]{8}-[a-z0-9][a-z0-9-]{1,80}$/;

/** A portable, empty allowlist used until a separately approved manifest is supplied. */
export const DEFAULT_SYSTEM_HELPER_MANIFEST: SystemHelperManifest = Object.freeze({
  schemaVersion: SYSTEM_HELPER_MANIFEST_SCHEMA,
  manifestId: 'default-deny',
  entries: Object.freeze([]),
});

export function parseSystemHelperManifest(value: unknown): SystemHelperManifest {
  const root = record(value, 'manifest');
  exactKeys(root, MANIFEST_KEY_SET, 'manifest');
  if (root.schema_version !== SYSTEM_HELPER_MANIFEST_SCHEMA) {
    throw new Error('manifest.schema_version must equal system-helper-manifest.v1');
  }
  const manifestId = identifier(root.manifest_id, 'manifest.manifest_id');
  const rawEntries = array(root.entries, 'manifest.entries');
  if (rawEntries.length > 64) throw new Error('manifest.entries must contain at most 64 entries');
  const entries = rawEntries.map((entry, index) => parseEntry(entry, `manifest.entries[${index}]`));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.helperId)) throw new Error(`duplicate helper_id: ${entry.helperId}`);
    ids.add(entry.helperId);
  }
  return Object.freeze({
    schemaVersion: SYSTEM_HELPER_MANIFEST_SCHEMA,
    manifestId,
    entries: Object.freeze(entries),
  });
}

/**
 * Checks a future provider invocation without spawning a process. The returned plan is
 * deliberately non-executable and is the only object a provider adapter may consume later.
 */
export function authorizeHelperActivation(
  manifest: SystemHelperManifest,
  request: HelperActivationRequest,
): HelperActivationPlan {
  assertCanonicalManifest(manifest);
  const entry = manifest.entries.find((candidate) => candidate.helperId === request.helperId);
  if (!entry || entry.state !== 'approved') {
    throw new Error('helper is not approved by the active manifest');
  }
  if (entry.artifact.pathRef !== request.pathRef) throw new Error('helper path reference does not match manifest');
  if (entry.artifact.version !== request.version) throw new Error('helper version does not match manifest');
  if (entry.artifact.sha256 !== normalizeRequestHash(request.sha256)) throw new Error('helper hash does not match manifest');
  if (!entry.invocation.allowedOperations.includes(request.operation)) {
    throw new Error('helper operation is not allowlisted');
  }
  for (const key of request.environmentKeys) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key) || SECRET_KEY_PATTERN.test(key)) {
      throw new Error('helper environment contains a forbidden key');
    }
    if (!entry.invocation.allowedEnvironmentKeys.includes(key)) {
      throw new Error(`helper environment key is not allowlisted: ${key}`);
    }
  }
  return Object.freeze({
    helperId: entry.helperId,
    pathRef: entry.artifact.pathRef,
    operation: request.operation,
    resourceLimits: entry.resourceLimits,
    audit: entry.audit,
    execution: 'not_performed',
  });
}

function parseEntry(value: unknown, path: string): SystemHelperEntry {
  const entry = record(value, path);
  exactKeys(entry, ENTRY_KEY_SET, path);
  const state = enumValue(entry.state, ['proposed', 'approved', 'revoked'] as const, `${path}.state`);
  const purpose = boundedString(entry.purpose, `${path}.purpose`, 1, 512);
  const artifact = parseArtifact(entry.artifact, `${path}.artifact`);
  const approval = parseApproval(entry.approval, `${path}.approval`);
  const capabilities = parseCapabilities(entry.capabilities, `${path}.capabilities`);
  const invocation = parseInvocation(entry.invocation, `${path}.invocation`);
  const dataPolicy = parseDataPolicy(entry.data_policy, `${path}.data_policy`);
  const resourceLimits = parseResourceLimits(entry.resource_limits, `${path}.resource_limits`);
  const lifecycle = parseLifecycle(entry.lifecycle, `${path}.lifecycle`);
  const audit = parseAudit(entry.audit, `${path}.audit`);
  const revocation = parseRevocation(entry.revocation, `${path}.revocation`);

  if (state === 'approved' && (!approval.approvedBy || !approval.approvedAtUtc)) {
    throw new Error(`${path}.approval must contain approver and UTC timestamp when state is approved`);
  }
  if (state !== 'approved' && (approval.approvedBy !== null || approval.approvedAtUtc !== null)) {
    throw new Error(`${path}.approval must be null-valued until helper state is approved`);
  }
  return Object.freeze({
    helperId: identifier(entry.helper_id, `${path}.helper_id`),
    state,
    purpose,
    artifact,
    approval,
    capabilities,
    invocation,
    dataPolicy,
    resourceLimits,
    lifecycle,
    audit,
    revocation,
  });
}

function assertCanonicalManifest(manifest: SystemHelperManifest): void {
  if (
    manifest.schemaVersion !== SYSTEM_HELPER_MANIFEST_SCHEMA ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > 64
  ) {
    throw new Error('helper manifest must be produced by parseSystemHelperManifest');
  }
  identifier(manifest.manifestId, 'manifest.manifestId');
  const ids = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.helperId !== 'string' ||
      !entry.artifact ||
      !entry.approval ||
      !entry.capabilities ||
      !entry.invocation ||
      !entry.dataPolicy ||
      !entry.resourceLimits ||
      !entry.lifecycle ||
      !entry.audit ||
      !entry.revocation ||
      ids.has(entry.helperId)
    ) {
      throw new Error('helper manifest contains an invalid or duplicate canonical entry');
    }
    ids.add(entry.helperId);
    // Re-run the complete wire validator so a type assertion cannot omit a policy field.
    parseEntry(canonicalEntryToWire(entry), `manifest.entries[${index}]`);
  }
}

function canonicalEntryToWire(entry: SystemHelperEntry): JsonRecord {
  return {
    helper_id: entry.helperId,
    state: entry.state,
    purpose: entry.purpose,
    artifact: {
      path_ref: entry.artifact.pathRef,
      version: entry.artifact.version,
      sha256: entry.artifact.sha256,
      source_url: entry.artifact.sourceUrl,
      license: entry.artifact.license,
      maintenance: entry.artifact.maintenance,
    },
    approval: {
      approved_by: entry.approval.approvedBy,
      approved_at_utc: entry.approval.approvedAtUtc,
    },
    capabilities: {
      allow: [...entry.capabilities.allow],
      deny: [...entry.capabilities.deny],
    },
    invocation: {
      allowed_operations: [...entry.invocation.allowedOperations],
      allowed_environment_keys: [...entry.invocation.allowedEnvironmentKeys],
      working_directory: entry.invocation.workingDirectory,
      network_access: entry.invocation.networkAccess,
      max_runtime_ms: entry.invocation.maxRuntimeMs,
      max_output_bytes: entry.invocation.maxOutputBytes,
      max_child_processes: entry.invocation.maxChildProcesses,
    },
    data_policy: {
      read_scopes: [...entry.dataPolicy.readScopes],
      write_scopes: [...entry.dataPolicy.writeScopes],
      sensitive_data: entry.dataPolicy.sensitiveData,
    },
    resource_limits: {
      cpu_seconds: entry.resourceLimits.cpuSeconds,
      memory_mib: entry.resourceLimits.memoryMib,
      disk_mib: entry.resourceLimits.diskMib,
    },
    lifecycle: {
      start: entry.lifecycle.start,
      health: entry.lifecycle.health,
      stop: entry.lifecycle.stop,
      crash_recovery: entry.lifecycle.crashRecovery,
    },
    audit: {
      event_type: entry.audit.eventType,
      checkpoint_id: entry.audit.checkpointId,
    },
    revocation: {
      action: entry.revocation.action,
      owner: entry.revocation.owner,
    },
  };
}

function parseArtifact(value: unknown, path: string): SystemHelperEntry['artifact'] {
  const artifact = record(value, path);
  exactKeys(artifact, ARTIFACT_KEY_SET, path);
  const pathRef = boundedString(artifact.path_ref, `${path}.path_ref`, 3, 96);
  if (!PATH_REF_PATTERN.test(pathRef)) throw new Error(`${path}.path_ref must be an explicit env/project/selection reference`);
  const version = boundedString(artifact.version, `${path}.version`, 1, 64);
  if (!VERSION_PATTERN.test(version)) throw new Error(`${path}.version contains invalid characters`);
  const sha256 = normalizeHash(artifact.sha256);
  const sourceUrl = boundedString(artifact.source_url, `${path}.source_url`, 1, 2048);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error(`${path}.source_url must be a valid HTTPS URL`);
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    throw new Error(`${path}.source_url must be a credential-free HTTPS documentation URL`);
  }
  const license = boundedString(artifact.license, `${path}.license`, 1, 128);
  const maintenance = enumValue(artifact.maintenance, ['active', 'security_supported', 'unknown'] as const, `${path}.maintenance`);
  return Object.freeze({
    pathRef: pathRef as HelperPathRef,
    version,
    sha256,
    sourceUrl,
    license,
    maintenance,
  });
}

function parseApproval(value: unknown, path: string): SystemHelperEntry['approval'] {
  const approval = record(value, path);
  exactKeys(approval, APPROVAL_KEY_SET, path);
  const approvedBy = nullableString(approval.approved_by, `${path}.approved_by`, 128);
  const approvedAtUtc = nullableString(approval.approved_at_utc, `${path}.approved_at_utc`, 64);
  if (approvedAtUtc !== null && !validDateTime(approvedAtUtc)) throw new Error(`${path}.approved_at_utc must be an ISO UTC timestamp`);
  return Object.freeze({ approvedBy, approvedAtUtc });
}

function parseCapabilities(value: unknown, path: string): SystemHelperEntry['capabilities'] {
  const capabilities = record(value, path);
  exactKeys(capabilities, CAPABILITIES_KEY_SET, path);
  const allow = capabilityList(capabilities.allow, `${path}.allow`);
  const deny = capabilityList(capabilities.deny, `${path}.deny`);
  for (const capability of allow) {
    if (!SAFE_CAPABILITY_SET.has(capability)) throw new Error(`${path}.allow contains a capability that is never executable`);
    if (deny.includes(capability)) throw new Error(`${path}.allow and deny overlap: ${capability}`);
  }
  for (const required of FORBIDDEN_HELPER_CAPABILITIES) {
    if (!deny.includes(required)) throw new Error(`${path}.deny must explicitly include ${required}`);
  }
  return Object.freeze({ allow: Object.freeze(allow), deny: Object.freeze(deny) });
}

function parseInvocation(value: unknown, path: string): SystemHelperEntry['invocation'] {
  const invocation = record(value, path);
  exactKeys(invocation, INVOCATION_KEY_SET, path);
  const allowedOperations = stringList(invocation.allowed_operations, `${path}.allowed_operations`, 1, 32);
  for (const operation of allowedOperations) {
    if (!OPERATION_PATTERN.test(operation) || SHELL_METACHARACTER_PATTERN.test(operation)) {
      throw new Error(`${path}.allowed_operations contains a non-symbolic operation`);
    }
  }
  const allowedEnvironmentKeys = stringList(invocation.allowed_environment_keys, `${path}.allowed_environment_keys`, 0, 32);
  for (const key of allowedEnvironmentKeys) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key) || SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`${path}.allowed_environment_keys contains a forbidden key`);
    }
  }
  const workingDirectory = enumValue(invocation.working_directory, ['none', 'project_relative', 'selected_path_parent'] as const, `${path}.working_directory`);
  if (invocation.network_access !== 'none') throw new Error(`${path}.network_access must be none`);
  return Object.freeze({
    allowedOperations: Object.freeze(allowedOperations),
    allowedEnvironmentKeys: Object.freeze(allowedEnvironmentKeys),
    workingDirectory,
    networkAccess: 'none' as const,
    maxRuntimeMs: boundedInteger(invocation.max_runtime_ms, `${path}.max_runtime_ms`, 100, 600000),
    maxOutputBytes: boundedInteger(invocation.max_output_bytes, `${path}.max_output_bytes`, 1024, 1048576),
    maxChildProcesses: boundedInteger(invocation.max_child_processes, `${path}.max_child_processes`, 0, 8),
  });
}

function parseDataPolicy(value: unknown, path: string): SystemHelperEntry['dataPolicy'] {
  const policy = record(value, path);
  exactKeys(policy, DATA_POLICY_KEY_SET, path);
  const readScopes = stringList(policy.read_scopes, `${path}.read_scopes`, 0, 32);
  for (const scope of readScopes) {
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`${path}.read_scopes contains an invalid scope`);
  }
  const writeScopes = stringList(policy.write_scopes, `${path}.write_scopes`, 0, 0);
  if (policy.sensitive_data !== 'deny') throw new Error(`${path}.sensitive_data must be deny`);
  return Object.freeze({
    readScopes: Object.freeze(readScopes),
    writeScopes: Object.freeze(writeScopes),
    sensitiveData: 'deny' as const,
  });
}

function parseResourceLimits(value: unknown, path: string): SystemHelperEntry['resourceLimits'] {
  const limits = record(value, path);
  exactKeys(limits, RESOURCE_LIMIT_KEY_SET, path);
  return Object.freeze({
    cpuSeconds: boundedInteger(limits.cpu_seconds, `${path}.cpu_seconds`, 1, 3600),
    memoryMib: boundedInteger(limits.memory_mib, `${path}.memory_mib`, 16, 16384),
    diskMib: boundedInteger(limits.disk_mib, `${path}.disk_mib`, 0, 1048576),
  });
}

function parseLifecycle(value: unknown, path: string): SystemHelperEntry['lifecycle'] {
  const lifecycle = record(value, path);
  exactKeys(lifecycle, LIFECYCLE_KEY_SET, path);
  if (lifecycle.start !== 'manual_approval') throw new Error(`${path}.start must be manual_approval`);
  if (lifecycle.health !== 'bounded_probe') throw new Error(`${path}.health must be bounded_probe`);
  if (lifecycle.stop !== 'graceful_then_force') throw new Error(`${path}.stop must be graceful_then_force`);
  if (lifecycle.crash_recovery !== 'disabled_until_review') throw new Error(`${path}.crash_recovery must be disabled_until_review`);
  return Object.freeze({
    start: 'manual_approval' as const,
    health: 'bounded_probe' as const,
    stop: 'graceful_then_force' as const,
    crashRecovery: 'disabled_until_review' as const,
  });
}

function parseAudit(value: unknown, path: string): SystemHelperEntry['audit'] {
  const audit = record(value, path);
  exactKeys(audit, AUDIT_KEY_SET, path);
  if (audit.event_type !== 'system-helper.invocation.v1') throw new Error(`${path}.event_type is not supported`);
  const checkpointId = boundedString(audit.checkpoint_id, `${path}.checkpoint_id`, 1, 96);
  if (!CHECKPOINT_PATTERN.test(checkpointId)) throw new Error(`${path}.checkpoint_id must identify a versioned checkpoint`);
  return Object.freeze({ eventType: 'system-helper.invocation.v1' as const, checkpointId });
}

function parseRevocation(value: unknown, path: string): SystemHelperEntry['revocation'] {
  const revocation = record(value, path);
  exactKeys(revocation, REVOCATION_KEY_SET, path);
  return Object.freeze({
    action: enumValue(revocation.action, ['mark_revoked', 'remove_entry'] as const, `${path}.action`),
    owner: boundedString(revocation.owner, `${path}.owner`, 1, 128),
  });
}

function capabilityList(value: unknown, path: string): HelperCapability[] {
  const values = stringList(value, path, 0, 15) as HelperCapability[];
  const known = new Set([...SAFE_HELPER_CAPABILITIES, ...FORBIDDEN_HELPER_CAPABILITIES]);
  for (const capability of values) {
    if (!known.has(capability)) throw new Error(`${path} contains unknown capability: ${capability}`);
  }
  return values;
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${path} contains unknown keys: ${unknown.join(', ')}`);
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length > 0) throw new Error(`${path} is missing keys: ${missing.join(', ')}`);
}

function identifier(value: unknown, path: string): string {
  const result = boundedString(value, path, 1, 64);
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(result)) throw new Error(`${path} contains invalid identifier characters`);
  return result;
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || value.trim() !== value) {
    throw new Error(`${path} must be a trimmed string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function nullableString(value: unknown, path: string, maximum: number): string | null {
  if (value === null) return null;
  return boundedString(value, path, 1, maximum);
}

function stringList(value: unknown, path: string, minimum: number, maximum: number): string[] {
  const values = array(value, path);
  if (values.length < minimum || values.length > maximum) throw new Error(`${path} length is outside the allowed range`);
  const result = values.map((entry, index) => boundedString(entry, `${path}[${index}]`, 1, 128));
  if (new Set(result).size !== result.length) throw new Error(`${path} must not contain duplicates`);
  return result;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${path} contains an unsupported value`);
  return value as T;
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') throw new Error('sha256 must be a lowercase hexadecimal string');
  if (!HASH_PATTERN.test(value)) throw new Error('sha256 must be exactly 64 lowercase hexadecimal characters');
  return value;
}

function normalizeRequestHash(value: unknown): string {
  if (typeof value !== 'string') throw new Error('helper hash must be hexadecimal');
  const hash = value.toLowerCase();
  if (!HASH_PATTERN.test(hash)) throw new Error('helper hash must be exactly 64 hexadecimal characters');
  return hash;
}

function validDateTime(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && value.endsWith('Z');
}
