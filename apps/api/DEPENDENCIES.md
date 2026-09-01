# API dependency record

Status: direct dependencies frozen for the mock control-plane implementation on 2026-08-25. Indirect versions and registry integrity are authoritative in the workspace `pnpm-lock.yaml`; the generated SBOM records every resolved component.

| Package/version | Scope | Purpose | Source | License | Permission surface | Evaluated alternative |
| --- | --- | --- | --- | --- | --- | --- |
| `@nestjs/common@11.2.2` | runtime | Modules, controllers, DI, validation integration | npm / NestJS official package | MIT | In-process application logic | Hand-built HTTP server rejected because it weakens module conventions |
| `@nestjs/core@11.2.2` | runtime | Nest application runtime | npm / NestJS official package | MIT | Process lifecycle and DI | None within the frozen NestJS stack |
| `@nestjs/platform-express@11.2.2` | runtime | Local REST transport | npm / NestJS official package | MIT | Configured local network listener | Fastify adapter deferred to avoid an extra integration branch |
| `@nestjs/platform-ws@11.2.2` | runtime | Native WebSocket adapter | npm / NestJS official package | MIT | Configured local WebSocket listener | Socket.IO deferred because native WebSocket satisfies v1 |
| `@nestjs/websockets@11.2.2` | runtime | WebSocket gateway lifecycle | npm / NestJS official package | MIT | In-memory subscriber fan-out | Raw upgrade handler would add transport plumbing |
| `class-transformer@0.5.1` | runtime | DTO query/body transformation | npm official package | MIT | Request objects only | Manual conversion is more error-prone |
| `class-validator@0.14.4` | runtime | Strict DTO validation | npm official package | MIT | Request objects only | JSON Schema remains suitable for shared artifacts but not decorator DTOs |
| `reflect-metadata@0.2.2` | runtime | Nest decorator metadata | npm official package | Apache-2.0 | In-process metadata | Required by the selected framework pattern |
| `rxjs@7.8.2` | runtime | Nest response interceptor stream | npm official package | Apache-2.0 | In-process streams | Nest itself uses RxJS |
| `ws@8.21.3` | runtime | Standards-based WebSocket implementation | npm official package | MIT | Configured local network listener | Socket.IO has a larger protocol/runtime surface |
| `@nestjs/cli@11.0.24` | development | Reproducible Nest build command | npm / NestJS official package | MIT | Reads source and writes `dist` | Direct `tsc` cannot reproduce all Nest CLI build conventions |
| `@nestjs/testing@11.2.2` | development | Nest module integration tests | npm / NestJS official package | MIT | In-process test server | Manual dependency construction misses framework wiring |
| `@types/express@5.0.6` | development | Express transport type declarations | npm DefinitelyTyped | MIT | Compile-time only | None needed |
| `@types/jest@29.5.14` | development | Jest test type declarations | npm DefinitelyTyped | MIT | Compile-time only | Node test runner would require a different Nest harness |
| `@types/node@24.13.0` | development | Frozen Node API declarations | npm DefinitelyTyped | MIT | Compile-time only | Runtime-derived types are not reproducible |
| `@types/supertest@7.2.1` | development | REST contract test declarations | npm DefinitelyTyped | MIT | Compile-time only | None needed |
| `@types/ws@8.18.1` | development | WebSocket declarations | npm DefinitelyTyped | MIT | Compile-time only | None needed |
| `jest@29.7.0` | development | Unit and contract test runner | npm official package | MIT | Reads source; writes coverage only when requested | Node test runner deferred because Nest tooling is Jest-oriented |
| `supertest@7.2.2` | development | In-process REST contract requests | npm official package | MIT | Loopback/in-process test transport | External HTTP client would require a bound test port |
| `ts-jest@29.4.5` | development | TypeScript transform compatible with Jest 29 | npm official package | MIT | Compile-time test transform | Babel/SWC would add another compiler dependency |
| `typescript@5.9.3` | development | Type checking and compilation | npm official package | Apache-2.0 | Reads source and writes build output | Required by the frozen TypeScript stack |

No package runs a real Android device, invokes a shell, reads credentials, uploads data or integrates with a ticketing platform. Install scripts and full transitive license results must still be checked from the frozen lockfile before release.
