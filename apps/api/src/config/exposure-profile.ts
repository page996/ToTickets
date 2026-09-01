import { isIP } from 'node:net';

export type ExposureProfileId = 'loopback.v1' | 'authenticated-tls.v1';

export interface ExposureProfile {
  readonly id: ExposureProfileId;
  readonly remoteAllowed: boolean;
  readonly requiredControls: readonly string[];
}

export const EXPOSURE_PROFILES: Readonly<Record<ExposureProfileId, ExposureProfile>> = Object.freeze({
  'loopback.v1': Object.freeze({
    id: 'loopback.v1',
    remoteAllowed: false,
    requiredControls: Object.freeze(['local_process_boundary']),
  }),
  'authenticated-tls.v1': Object.freeze({
    id: 'authenticated-tls.v1',
    remoteAllowed: true,
    requiredControls: Object.freeze(['authentication', 'tls', 'rbac', 'csrf', 'ws_handshake_auth']),
  }),
});

// This is the only profile enabled by runtime-config.v3. Remote profiles remain
// descriptive until their controls and negative tests are shipped.
export const ACTIVE_EXPOSURE_PROFILE: ExposureProfileId = 'loopback.v1';

const IPV6_LOOPBACK_BIND_HOST = '::1'; // compliance: loopback-bind-policy-constant

export function validateBindHost(value: unknown, profileId: ExposureProfileId = ACTIVE_EXPOSURE_PROFILE): string {
  const bindHost = typeof value === 'string' ? value.trim() : '';
  if (!bindHost) throw new Error('api.bind_host must be a non-empty string');
  if (profileId !== 'loopback.v1') {
    throw new Error(`exposure profile ${profileId} is not enabled`);
  }
  const isIpv4Loopback = isIP(bindHost) === 4 && Number(bindHost.split('.')[0]) === 127;
  if (!isIpv4Loopback && bindHost !== IPV6_LOOPBACK_BIND_HOST) {
    throw new Error(`api.bind_host must be an IPv4 127/8 address or ${IPV6_LOOPBACK_BIND_HOST}`);
  }
  return bindHost;
}
