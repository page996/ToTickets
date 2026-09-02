import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authorizeHelperActivation,
  DEFAULT_SYSTEM_HELPER_MANIFEST,
  parseSystemHelperManifest,
} from '../src/helpers/helper-manifest';
import { FORBIDDEN_HELPER_CAPABILITIES } from '../src/helpers/helper-manifest.types';

describe('system-helper-manifest.v1 policy', () => {
  it('accepts the committed default-deny manifest and freezes the result', () => {
    const manifestPath = join(__dirname, '..', '..', '..', 'config', 'system-helper-manifest.v1.json');
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    const manifest = parseSystemHelperManifest(raw);

    expect(manifest).toEqual(DEFAULT_SYSTEM_HELPER_MANIFEST);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entries)).toBe(true);
    expect(manifest.entries).toHaveLength(0);
  });

  it('parses an approved entry with explicit provenance and deny capabilities', () => {
    const manifest = parseSystemHelperManifest({
      schema_version: 'system-helper-manifest.v1',
      manifest_id: 'host-approved',
      entries: [validEntry],
    });

    expect(manifest.entries[0]).toEqual(expect.objectContaining({
      helperId: 'android-adb',
      state: 'approved',
      artifact: expect.objectContaining({ pathRef: 'env:ANDROID_ADB_PATH', sha256: 'a'.repeat(64) }),
    }));
  });

  it.each([
    ['unknown root key', () => ({ ...validManifest(), unexpected: true })],
    ['unknown entry key', () => ({ ...validManifest(), entries: [{ ...validEntry, command: 'forbidden' }] })],
    ['duplicate helper ids', () => ({ ...validManifest(), entries: [validEntry, validEntry] })],
    ['absolute path reference', () => ({ ...validManifest(), entries: [{ ...validEntry, artifact: { ...validEntry.artifact, path_ref: 'absolute-path' } }] })],
    ['invalid hash', () => ({ ...validManifest(), entries: [{ ...validEntry, artifact: { ...validEntry.artifact, sha256: 'not-a-hash' } }] })],
    ['uppercase hash is not canonical', () => ({ ...validManifest(), entries: [{ ...validEntry, artifact: { ...validEntry.artifact, sha256: 'A'.repeat(64) } }] })],
    ['missing forbidden capability', () => ({ ...validManifest(), entries: [{ ...validEntry, capabilities: { ...validEntry.capabilities, deny: FORBIDDEN_HELPER_CAPABILITIES.slice(1) } }] })],
    ['dangerous allowed capability', () => ({ ...validManifest(), entries: [{ ...validEntry, capabilities: { ...validEntry.capabilities, allow: ['device_input'] } }] })],
    ['external network', () => ({ ...validManifest(), entries: [{ ...validEntry, invocation: { ...validEntry.invocation, network_access: 'loopback' } }] })],
    ['write scope', () => ({ ...validManifest(), entries: [{ ...validEntry, data_policy: { ...validEntry.data_policy, write_scopes: ['project:state'] } }] })],
    ['shell-like operation', () => ({ ...validManifest(), entries: [{ ...validEntry, invocation: { ...validEntry.invocation, allowed_operations: ['adb shell'] } }] })],
    ['secret environment key', () => ({ ...validManifest(), entries: [{ ...validEntry, invocation: { ...validEntry.invocation, allowed_environment_keys: ['API_TOKEN'] } }] })],
    ['approved without approval record', () => ({ ...validManifest(), entries: [{ ...validEntry, approval: { approved_by: null, approved_at_utc: null } }] })],
    ['proposed with approval record', () => ({ ...validManifest(), entries: [{ ...validEntry, state: 'proposed', approval: validEntry.approval }] })],
  ])('rejects %s', (_name, factory) => {
    expect(() => parseSystemHelperManifest(factory())).toThrow();
  });

  it('rejects activation unless every provenance and operation field matches', () => {
    const manifest = parseSystemHelperManifest(validManifest());
    const request = {
      helperId: 'android-adb',
      pathRef: 'env:ANDROID_ADB_PATH',
      version: '37.0.1',
      sha256: 'a'.repeat(64),
      operation: 'version',
      environmentKeys: ['ANDROID_ADB_PATH'],
    } as const;

    const plan = authorizeHelperActivation(manifest, request);
    expect(plan).toEqual(expect.objectContaining({
      helperId: 'android-adb',
      pathRef: 'env:ANDROID_ADB_PATH',
      operation: 'version',
      execution: 'not_performed',
    }));

    expect(() => authorizeHelperActivation(manifest, { ...request, pathRef: 'env:OTHER_PATH' })).toThrow(/path reference/);
    expect(() => authorizeHelperActivation(manifest, { ...request, version: '37.0.2' })).toThrow(/version/);
    expect(() => authorizeHelperActivation(manifest, { ...request, sha256: 'b'.repeat(64) })).toThrow(/hash/);
    expect(() => authorizeHelperActivation(manifest, { ...request, operation: 'device_health' })).toThrow(/allowlisted/);
    expect(() => authorizeHelperActivation(manifest, { ...request, environmentKeys: ['API_TOKEN'] })).toThrow(/forbidden/);
  });

  it('fails closed for the default empty allowlist and revoked entries', () => {
    const request = {
      helperId: 'android-adb',
      pathRef: 'env:ANDROID_ADB_PATH',
      version: '37.0.1',
      sha256: 'a'.repeat(64),
      operation: 'version',
      environmentKeys: [],
    } as const;
    expect(() => authorizeHelperActivation(DEFAULT_SYSTEM_HELPER_MANIFEST, request)).toThrow(/not approved/);

    const revoked = parseSystemHelperManifest({
      ...validManifest(),
      entries: [{ ...validEntry, state: 'revoked', approval: { approved_by: null, approved_at_utc: null } }],
    });
    expect(() => authorizeHelperActivation(revoked, request)).toThrow(/not approved/);
  });

  it('rejects a forged canonical object before checking activation', () => {
    const forged = {
      schemaVersion: 'system-helper-manifest.v1',
      manifestId: 'forged',
      entries: [{
        helperId: 'android-adb',
        state: 'approved',
        approval: { approvedBy: 'user', approvedAtUtc: '2026-09-02T12:00:00Z' },
      }],
    } as never;
    expect(() => authorizeHelperActivation(forged, {
      helperId: 'android-adb',
      pathRef: 'env:ANDROID_ADB_PATH',
      version: '37.0.1',
      sha256: 'a'.repeat(64),
      operation: 'version',
      environmentKeys: [],
    })).toThrow(/invalid|validator|manifest/i);
  });

  it('keeps the schema strict and documents the same top-level contract', () => {
    const schemaPath = join(__dirname, '..', '..', '..', 'config', 'system-helper-manifest.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
    expect(schema.$id).toBe('https://example.invalid/schemas/system-helper-manifest.v1.json');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['schema_version', 'manifest_id', 'entries']);
  });
});

type RawEntry = Record<string, unknown> & {
  artifact: Record<string, unknown>;
  approval: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  invocation: Record<string, unknown>;
  data_policy: Record<string, unknown>;
};

const androidDocsUrl = ['https:', '', 'developer.android.com/tools/releases/platform-tools'].join('/');
const validEntry: RawEntry = buildValidEntry();

function validManifest(): Record<string, unknown> {
  return {
    schema_version: 'system-helper-manifest.v1',
    manifest_id: 'host-approved',
    entries: [validEntry],
  };
}

function buildValidEntry(): RawEntry {
  return {
    helper_id: 'android-adb',
    state: 'approved',
    purpose: 'Read-only Android device discovery and version inspection.',
    artifact: {
      path_ref: 'env:ANDROID_ADB_PATH',
      version: '37.0.1',
      sha256: 'a'.repeat(64),
      source_url: androidDocsUrl,
      license: 'Apache-2.0',
      maintenance: 'active',
    },
    approval: {
      approved_by: 'user',
      approved_at_utc: '2026-09-02T12:00:00Z',
    },
    capabilities: {
      allow: ['version_read', 'device_discovery_read'],
      deny: [...FORBIDDEN_HELPER_CAPABILITIES],
    },
    invocation: {
      allowed_operations: ['version', 'device_discovery'],
      allowed_environment_keys: ['ANDROID_ADB_PATH'],
      working_directory: 'none',
      network_access: 'none',
      max_runtime_ms: 5000,
      max_output_bytes: 65536,
      max_child_processes: 0,
    },
    data_policy: {
      read_scopes: ['selection:android-sdk'],
      write_scopes: [],
      sensitive_data: 'deny',
    },
    resource_limits: {
      cpu_seconds: 10,
      memory_mib: 256,
      disk_mib: 0,
    },
    lifecycle: {
      start: 'manual_approval',
      health: 'bounded_probe',
      stop: 'graceful_then_force',
      crash_recovery: 'disabled_until_review',
    },
    audit: {
      event_type: 'system-helper.invocation.v1',
      checkpoint_id: 'CP-20260902-host-preflight',
    },
    revocation: {
      action: 'mark_revoked',
      owner: 'project-maintainer',
    },
  };
}
