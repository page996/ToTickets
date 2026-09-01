# Mock Control Plane API

This package is the NestJS control plane for the local, human-in-the-loop console. It contains no real-platform integration and no device input primitive.

## Scope

- In-memory device, schedule and audit repositories behind separate repository providers.
- Read-only device capabilities and lifecycle state transitions.
- Server-issued, short-lived confirmation tickets for lifecycle, preview, focus and emergency-stop commands.
- UTC timestamps, monotonic countdown calculation and local clock-drift reporting.
- Versioned REST endpoints under the protocol constant `/api/v1`.
- Native WebSocket CloudEvents stream at the protocol route `/api/v1/events`.
- Fail-closed request validation, idempotency and policy denial for sensitive fields or prohibited operations.

The package intentionally has no click, tap, text input, OCR, CAPTCHA, purchase, order or payment adapter.

## Configuration

No runtime address, port or filesystem path has a compiled default. The required
configuration contract is `runtime-config.v3`; an older file or an omitted schema
version fails closed during startup. Supply exactly one of these sources:

- `CONTROL_CONFIG_FILE`, pointing to a validated JSON configuration file. A relative
  value is resolved from the process working directory. When this variable is set,
  the JSON file is the source of truth and the API-only environment fields below are
  not read directly.
- The explicitly allowlisted API-only environment variables consumed by
  `src/config/runtime-config.ts`, with `CONTROL_CONFIG_FILE` unset.

The repository example at `config/config.example.json` is a complete v3 file. It
uses `${NAME}` placeholders for deployment-specific values, but placeholders are
not mandatory: literal values are accepted wherever the versioned schema permits
them. Any placeholder that is present is expanded from the environment at startup,
and unresolved or empty placeholders fail closed. A `CONTROL_CONFIG_FILE` is a
complete configuration and must include `storage` and `tools`; those sections are
validated deployment metadata but are not consumed by the current bounded
in-memory API adapters.

Integer fields in JSON must be JSON integers or integer placeholders. Placeholder
values and API-only environment integer values are parsed at the environment
boundary as strict unsigned base-10 safe integers before normal range validation;
numeric strings embedded directly in JSON are rejected. `allowed_origins` must be
non-empty and every value must be an absolute HTTP(S) origin. The idempotency TTL
is bounded to 30-600 seconds.

Because authentication, TLS, RBAC and CSRF protection are not implemented,
`api.bind_host` is a startup security gate: it accepts only an explicit IPv4
address in `127.0.0.0/8` or the exact IPv6 loopback address `::1`. Wildcard
addresses, host names (including `localhost`) and every other IP address fail
closed. There is no compiled bind-address default, so deployments must still
choose the loopback address explicitly.

Required keys for API-only environment startup are:

```text
CONFIG_SCHEMA_VERSION=runtime-config.v3
CONTROL_BIND_HOST             # explicit IPv4 127/8 address or ::1 only
CONTROL_PORT                  # integer in the configured non-privileged range
CONSOLE_ORIGINS               # comma-separated absolute HTTP(S) origins
MAX_DEVICES                   # bounded device repository capacity
MAX_SCHEDULES                 # bounded schedule repository capacity
HEARTBEAT_SECONDS             # health heartbeat interval
AUDIT_RETENTION_DAYS          # time-based audit retention
AUDIT_MAX_RECORDS             # bounded audit repository capacity
CLOCK_TOLERANCE_MS            # allowed wall-clock drift
WEBSOCKET_MAX_CLIENTS         # concurrent event-stream client capacity
WEBSOCKET_MAX_BUFFERED_BYTES  # per-client outbound queue budget
WEBSOCKET_MAX_PAYLOAD_BYTES   # inbound WebSocket frame limit
EVENT_REPLAY_BATCH_SIZE       # replay batch size before yielding
EVENT_REPLAY_MAX_EVENTS       # per-connection replay budget
OPERATION_QUEUE_MAX_QUEUED    # bounded wait queue for keyed/global operations
IDEMPOTENCY_TTL_SECONDS       # completed idempotency entry lifetime
IDEMPOTENCY_MAX_ENTRIES       # bounded idempotency cache capacity
CONFIRMATION_TTL_SECONDS      # confirmation ticket lifetime
CONFIRMATION_MAX_ENTRIES      # bounded confirmation ticket capacity
EVENT_HISTORY_SIZE            # retained event window
POLICY_VERSION                # non-empty policy identifier
```

When using the complete example file, it additionally references these deployment
placeholders: `CONSOLE_ORIGIN` (one origin in the example array),
`PROJECT_DATA_DIR`, `PROJECT_LOG_DIR`, `ANDROID_ADB_PATH`, `SCRCPY_PATH`, and
`ANDROID_EMULATOR_PATH`. Values are deployment inputs only; the repository does not
guess system paths or executable locations.

Use the repository's isolated toolchain wrappers and workspace lockfile. Do not install these dependencies globally.

## Verification

From the repository root, after toolchain bootstrap and frozen dependency installation:

```powershell
./scripts/pnpm.ps1 --filter @ticketing-console/api typecheck
./scripts/pnpm.ps1 --filter @ticketing-console/api test
./scripts/pnpm.ps1 --filter @ticketing-console/api build
```

Tests generate their host and port fixtures at runtime; they do not embed a deployment endpoint.

## Storage boundary

Version 0.1 uses bounded process-memory repositories, so data resets on restart. The device, schedule and audit services depend on separate repositories; a later SQLite adapter can replace each provider without changing REST controllers or exposing another module's schema.
