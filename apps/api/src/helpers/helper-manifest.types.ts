export const SYSTEM_HELPER_MANIFEST_SCHEMA = 'system-helper-manifest.v1' as const;

export type HelperManifestState = 'proposed' | 'approved' | 'revoked';

export type HelperCapability =
  | 'version_read'
  | 'metadata_read'
  | 'health_read'
  | 'lifecycle_control'
  | 'screen_observation'
  | 'device_discovery_read'
  | 'device_input'
  | 'ui_automation'
  | 'credential_access'
  | 'transaction_automation'
  | 'private_api'
  | 'network_external'
  | 'risk_control_evasion'
  | 'apk_install'
  | 'data_export';

export const SAFE_HELPER_CAPABILITIES: readonly HelperCapability[] = Object.freeze([
  'version_read',
  'metadata_read',
  'health_read',
  'lifecycle_control',
  'screen_observation',
  'device_discovery_read',
]);

export const FORBIDDEN_HELPER_CAPABILITIES: readonly HelperCapability[] = Object.freeze([
  'device_input',
  'ui_automation',
  'credential_access',
  'transaction_automation',
  'private_api',
  'network_external',
  'risk_control_evasion',
  'apk_install',
  'data_export',
]);

export type HelperPathRef = `env:${string}` | `project:${string}` | `selection:${string}`;

export interface HelperArtifact {
  readonly pathRef: HelperPathRef;
  readonly version: string;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly maintenance: 'active' | 'security_supported' | 'unknown';
}

export interface HelperApproval {
  readonly approvedBy: string | null;
  readonly approvedAtUtc: string | null;
}

export interface HelperCapabilities {
  readonly allow: readonly HelperCapability[];
  readonly deny: readonly HelperCapability[];
}

export interface HelperInvocationPolicy {
  readonly allowedOperations: readonly string[];
  readonly allowedEnvironmentKeys: readonly string[];
  readonly workingDirectory: 'none' | 'project_relative' | 'selected_path_parent';
  readonly networkAccess: 'none';
  readonly maxRuntimeMs: number;
  readonly maxOutputBytes: number;
  readonly maxChildProcesses: number;
}

export interface HelperDataPolicy {
  readonly readScopes: readonly string[];
  readonly writeScopes: readonly string[];
  readonly sensitiveData: 'deny';
}

export interface HelperResourceLimits {
  readonly cpuSeconds: number;
  readonly memoryMib: number;
  readonly diskMib: number;
}

export interface HelperLifecyclePolicy {
  readonly start: 'manual_approval';
  readonly health: 'bounded_probe';
  readonly stop: 'graceful_then_force';
  readonly crashRecovery: 'disabled_until_review';
}

export interface HelperAuditPolicy {
  readonly eventType: 'system-helper.invocation.v1';
  readonly checkpointId: string;
}

export interface HelperRevocationPolicy {
  readonly action: 'mark_revoked' | 'remove_entry';
  readonly owner: string;
}

export interface SystemHelperEntry {
  readonly helperId: string;
  readonly state: HelperManifestState;
  readonly purpose: string;
  readonly artifact: HelperArtifact;
  readonly approval: HelperApproval;
  readonly capabilities: HelperCapabilities;
  readonly invocation: HelperInvocationPolicy;
  readonly dataPolicy: HelperDataPolicy;
  readonly resourceLimits: HelperResourceLimits;
  readonly lifecycle: HelperLifecyclePolicy;
  readonly audit: HelperAuditPolicy;
  readonly revocation: HelperRevocationPolicy;
}

export interface SystemHelperManifest {
  readonly schemaVersion: typeof SYSTEM_HELPER_MANIFEST_SCHEMA;
  readonly manifestId: string;
  readonly entries: readonly SystemHelperEntry[];
}

export interface HelperActivationRequest {
  readonly helperId: string;
  readonly pathRef: string;
  readonly version: string;
  readonly sha256: string;
  readonly operation: string;
  readonly environmentKeys: readonly string[];
}

export interface HelperActivationPlan {
  readonly helperId: string;
  readonly pathRef: HelperPathRef;
  readonly operation: string;
  readonly resourceLimits: HelperResourceLimits;
  readonly audit: HelperAuditPolicy;
  readonly execution: 'not_performed';
}
