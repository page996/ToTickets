# 依赖目录

状态：2026-08-25 实施冻结基线。本文记录当前 manifest 中的全部直接 npm/crate 依赖和工具链；不是对尚未纳入仓库的 ADB、scrcpy 或模拟器的批准。

## 1. 审计真源与结论

- 直接 Node 依赖以 `package.json` 为真源，精确解析结果和 SHA-512 SRI 以 `pnpm-lock.yaml` 为真源。
- 直接 Rust 依赖以 `Cargo.toml` 为真源，精确解析结果和 SHA-256 checksum 以同目录 `Cargo.lock` 为真源。
- Node、pnpm、Rust 版本与分发校验值以 `config/toolchain.lock.json` 为真源，并由项目 wrapper 选择仓库内工具。
- `node_modules`、`.pnpm-store` 和 `.tools` 是可重建工作目录，不是审计真源；安装中断后必须按冻结锁文件重建，不能根据现有安装目录反向修改 manifest/lockfile。
- 本次从 npm registry 和 crates.io 的精确版本元数据核对了全部直接包的许可证、上游仓库和发布完整性；直接包发布完整性均与仓库锁文件一致。

锁文件当前包含 679 条 pnpm package 记录和 462 条 Cargo package 记录（均含平台/可选依赖，Cargo 数量包含工作区包）。确定性的开发/构建 CycloneDX 1.6 清单位于 `sbom/human-ticketing-console.cdx.json`，包含 1,143 个组件和 1,144 个依赖节点；它记录完整锁定图和校验值，但传递依赖许可证仍标记为未决，不能替代发布许可证审查。

表中权限面缩写：`P0` 仅类型/编译；`P1` 进程内逻辑；`P2` 本地 HTTP/WebSocket；`P3` Tauri WebView/IPC；`P4` 构建工具，可读写构建目录并启动编译子进程。来源 `npm` 指精确版本的 [npm registry](https://registry.npmjs.org/) 发布记录，来源 `crates.io` 指精确版本的 [crates.io](https://crates.io/) 发布记录。每行的 Package URL 是后续 SBOM 的稳定组件引用。

## 2. NestJS API 运行时直接依赖

引入 manifest：`apps/api/package.json` 的 `dependencies`。

| name/version | purpose | source/license | 权限面 | integrity / SBOM ref |
| --- | --- | --- | --- | --- |
| `@nestjs/common@11.2.2` | 模块、依赖注入、控制器和异常基础 API | npm / MIT | P1 | `sha512-U/qJ1cl/rpcN/P0yYNEy1m37fb5rQdu2x2tXVUHmuDCpx5es+9aqKy8odgltpZsQAl4rY5ZwftTXzhjahcQKnw==`; `pkg:npm/%40nestjs/common@11.2.2` |
| `@nestjs/core@11.2.2` | Nest 应用启动、容器和请求生命周期 | npm / MIT | P1 | `sha512-U2stdm6un1f5UcbfDMjxtVRnq933kREURc1D8cKSmtz22WOiD2eshgzdvPRSAYWWaWvVAW3Ed62yMlaHFWraig==`; `pkg:npm/%40nestjs/core@11.2.2` |
| `@nestjs/platform-express@11.2.2` | 本地 REST 服务的 Express 适配器 | npm / MIT | P2 | `sha512-vzOLYkrIC/eGxE1oSWv5I/R+1/4CLBbjeLlRPOIf5gxCjUH1cVmavkO7JJ/w5hCUXiELXGWhoDpBF/+/n245gA==`; `pkg:npm/%40nestjs/platform-express@11.2.2` |
| `@nestjs/platform-ws@11.2.2` | Nest 原生 WebSocket transport 适配器 | npm / MIT | P2 | `sha512-spSsxPdGy9hGqlPwTH8gC327H2jKRe6/4RmZRU1RJYyxOBQWzoP8MtoI+8rCF2TEIuGJKzDKNoi3PhTOLB2CTQ==`; `pkg:npm/%40nestjs/platform-ws@11.2.2` |
| `@nestjs/websockets@11.2.2` | 事件 gateway、装饰器和消息生命周期 | npm / MIT | P2 | `sha512-brSfjatUsw9SgLYMD6VdrgUE+c92Ky2UwJeAU1rKvJOrEsxoiLm2BYxsPFp87amd/UdxZqzIbZMQ/wsnILPYyQ==`; `pkg:npm/%40nestjs/websockets@11.2.2` |
| `class-transformer@0.5.1` | DTO 的显式类型转换 | npm / MIT | P1 | `sha512-SQa1Ws6hUbfC98vKGxZH3KFY0Y1lm5Zm0SY8XX9zbK7FJCyVEac3ATW0RIpwzW+oOfmHE5PMPufDG9hCfoEOMw==`; `pkg:npm/class-transformer@0.5.1` |
| `class-validator@0.14.4` | REST DTO 约束和拒绝非法输入 | npm / MIT | P1 | `sha512-AwNusCCam51q703dW82x95tOqQp6oC9HNUl724KxJJOfnKscI8dOloXFgyez7LbTTKWuRBA37FScqVbJEoq8Yw==`; `pkg:npm/class-validator@0.14.4` |
| `reflect-metadata@0.2.2` | Nest 装饰器与依赖注入元数据 | npm / Apache-2.0 | P1 | `sha512-urBwgfrvVP/eAyXx4hluJivBKzuEbSQs9rKWCrCkbSxNv8mxPcUZKeuoF3Uy4mJl3Lwprp6yy5/39VWigZ4K6Q==`; `pkg:npm/reflect-metadata@0.2.2` |
| `rxjs@7.8.2` | Nest 事件/流式生命周期的 Observable | npm / Apache-2.0 | P1 | `sha512-dhKf903U/PQZY6boNNtAGdWbG85WAbjT/1xYoZIC7FAY0yWapOBQVsVrDl58W86//e1VpMNBtRV4MaXfdMySFA==`; `pkg:npm/rxjs@7.8.2` |
| `ws@8.21.3` | WebSocket 服务端协议实现 | npm / MIT | P2 | `sha512-201TZ/kPWxoPr/OKWjquZR1SWKXcvxdH+e1xrx89b3YbmzLMFCLfnaG1HFIgWzJOEWZ7MvpK++odZufgYR50Rw==`; `pkg:npm/ws@8.21.3` |

## 3. NestJS API 开发直接依赖

引入 manifest：`apps/api/package.json` 的 `devDependencies`。这些包不进入部署期 API 运行时闭包。

| name/version | purpose | source/license | 权限面 | integrity / SBOM ref |
| --- | --- | --- | --- | --- |
| `@nestjs/cli@11.0.24` | Nest 编译和开发 watch 命令 | npm / MIT | P4 | `sha512-aIHxQLSYtXShifA3zwWIeznEsZnNa3Iz2QRykFj+sl9IcbERBHr5nH87FRgywM+He3NxoF5WazHfR8FsmVeWxw==`; `pkg:npm/%40nestjs/cli@11.0.24` |
| `@nestjs/testing@11.2.2` | Nest 测试模块和依赖覆盖 | npm / MIT | P1 | `sha512-Zhf4Lh0zfhpA+d2p4mXsI7Fl7vQw2d1SXhNO2BNk1Ka++G/PFPhN3rHR/kySSmAzopJR31rDjdI8wZ9tJ4k3Hg==`; `pkg:npm/%40nestjs/testing@11.2.2` |
| `@types/express@5.0.6` | Express 编译期类型 | npm / MIT | P0 | `sha512-sKYVuV7Sv9fbPIt/442koC7+IIwK5olP1KWeD88e/idgoJqDm3JV/YUiPwkoKK92ylff2MGxSz1CSjsXelx0YA==`; `pkg:npm/%40types/express@5.0.6` |
| `@types/jest@29.5.14` | Jest 编译期类型 | npm / MIT | P0 | `sha512-ZN+4sdnLUbo8EVvVc2ao0GFW6oVrQRPn4K2lglySj7APvSrgzxHiNNK99us4WDMi57xxA2yggblIAMNhXOotLQ==`; `pkg:npm/%40types/jest@29.5.14` |
| `@types/node@24.13.0` | API 使用的 Node 编译期类型，与项目运行时版本一致 | npm / MIT | P0 | `sha512-5vtOqGQr4NJKeEzV441FcOi2MeG9UTWq9LqVLGneDdu4vlX17H8kQ2PA2UmNwCUGPVDj4oBjNhS7ReVEIWJJrg==`; `pkg:npm/%40types/node@24.13.0` |
| `@types/supertest@7.2.1` | HTTP 契约测试编译期类型 | npm / MIT | P0 | `sha512-4CbBvoYVLHL7+yhbYrZET0vsvuyXTC05aRe7dNQkwMzm56auceoy6Yu3K50uZmwfHna1os3CMSgM/3QVkUtPTw==`; `pkg:npm/%40types/supertest@7.2.1` |
| `@types/ws@8.18.1` | WebSocket 测试/服务编译期类型 | npm / MIT | P0 | `sha512-ThVF6DCVhA8kUGy+aazFQ4kXQ7E1Ty7A3ypFOe0IcJV8O/M511G99AW24irKrW56Wt44yG9+ij8FaqoBGkuBXg==`; `pkg:npm/%40types/ws@8.18.1` |
| `jest@29.7.0` | API 单元和 E2E 测试运行器 | npm / MIT | P4 | `sha512-NIy3oAFp9shda19hy4HK0HRTWKtPJmGdnvywu01nOqNC2vZg+Z+fvJDxpMQA88eb2I9EcafcdjYgsDthnYTvGw==`; `pkg:npm/jest@29.7.0` |
| `supertest@7.2.2` | 本地 HTTP 接口断言 | npm / MIT | P2 | `sha512-oK8WG9diS3DlhdUkcFn4tkNIiIbBx9lI2ClF8K+b2/m8Eyv47LSawxUzZQSNKUrVb2KsqeTDCcjAAVPYaSLVTA==`; `pkg:npm/supertest@7.2.2` |
| `ts-jest@29.4.5` | Jest 的 TypeScript 转换器 | npm / MIT | P4 | `sha512-HO3GyiWn2qvTQA4kTgjDcXiMwYQt68a1Y8+JuLRVpdIzm+UOLSHgl/XqR4c6nzJkq5rOkjc02O2I7P7l/Yof0Q==`; `pkg:npm/ts-jest@29.4.5` |
| `typescript@5.9.3` | API 编译和静态类型检查 | npm / Apache-2.0 | P4 | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`; `pkg:npm/typescript@5.9.3` |

事件 payload schema 契约断言只复用 Node.js 内置 `fs`/`path` 与现有 Jest，未新增直接或间接依赖，因此 manifest、pnpm 锁文件和 SBOM 不发生变化。

## 4. Tauri/React 控制台运行时直接依赖

引入 manifest：`apps/console/package.json` 的 `dependencies`。

| name/version | purpose | source/license | 权限面 | integrity / SBOM ref |
| --- | --- | --- | --- | --- |
| `@tauri-apps/api@2.8.0` | WebView 到受限 Tauri 壳的官方 API | npm / `Apache-2.0 OR MIT` | P3 | `sha512-ga7zdhbS2GXOMTIZRT0mYjKJtR9fivsXzsyq5U3vjDL0s6DTMwYRm0UHNjzTY5dh4+LSC68Sm/7WEiimbQNYlw==`; `pkg:npm/%40tauri-apps/api@2.8.0` |
| `lucide-react@0.468.0` | 控制台命令和状态图标 | npm / ISC | P1 | `sha512-6koYRhnM2N0GGZIdXzSeiNwguv1gt/FAjZOiPl76roBi3xKEXa4WmfpxgQwTTL4KipXjefrnf3oV4IsYhi4JFA==`; `pkg:npm/lucide-react@0.468.0` |
| `react@19.1.1` | 控制台组件和状态模型 | npm / MIT | P1 | `sha512-w8nqGImo45dmMIfljjMwOGtbmC/mk4CMYhWIicdSflH91J9TyCyczcPFXJzrZ/ZXcgGRFeP6BU0BEJTw6tZdfQ==`; `pkg:npm/react@19.1.1` |
| `react-dom@19.1.1` | React DOM/WebView 渲染 | npm / MIT | P3 | `sha512-Dlq/5LAZgF0Gaz6yiqZCf6VCcZs1ghAJyrsu84Q/GT0gV+mCxbfmKNoGRKBYMJ8IEdGPqu49YWXD02GCknEDkw==`; `pkg:npm/react-dom@19.1.1` |

## 5. Tauri/React 控制台开发直接依赖

引入 manifest：`apps/console/package.json` 的 `devDependencies`。

| name/version | purpose | source/license | 权限面 | integrity / SBOM ref |
| --- | --- | --- | --- | --- |
| `@tauri-apps/cli@2.8.4` | Tauri 开发、构建和安装包编排 | npm / `Apache-2.0 OR MIT` | P4 | `sha512-ejUZBzuQRcjFV+v/gdj/DcbyX/6T4unZQjMSBZwLzP/CymEjKcc2+Fc8xTORThebHDUvqoXMdsCZt8r+hyN15g==`; `pkg:npm/%40tauri-apps/cli@2.8.4` |
| `@types/node@24.13.0` | Vite 和构建脚本的 Node 编译期类型，与项目运行时版本一致 | npm / MIT | P0 | `sha512-5vtOqGQr4NJKeEzV441FcOi2MeG9UTWq9LqVLGneDdu4vlX17H8kQ2PA2UmNwCUGPVDj4oBjNhS7ReVEIWJJrg==`; `pkg:npm/%40types/node@24.13.0` |
| `@types/react@19.1.10` | React 编译期类型 | npm / MIT | P0 | `sha512-EhBeSYX0Y6ye8pNebpKrwFJq7BoQ8J5SO6NlvNwwHjSj6adXJViPQrKlsyPw7hLBLvckEMO1yxeGdR82YBBlDg==`; `pkg:npm/%40types/react@19.1.10` |
| `@types/react-dom@19.1.7` | React DOM 编译期类型 | npm / MIT | P0 | `sha512-i5ZzwYpqjmrKenzkoLM2Ibzt6mAsM7pxB6BCIouEVVmgiqaMj1TjaK7hnA36hbW5aZv20kx7Lw6hWzPWg0Rurw==`; `pkg:npm/%40types/react-dom@19.1.7` |
| `@vitejs/plugin-react@5.0.2` | Vite 的 React JSX/Fast Refresh 转换 | npm / MIT | P4 | `sha512-tmyFgixPZCx2+e6VO9TNITWcCQl8+Nl/E8YbAyPVv85QCc7/A3JrdfG2A8gIzvVhWuzMOVrFW1aReaNxrI6tbw==`; `pkg:npm/%40vitejs/plugin-react@5.0.2` |
| `typescript@5.9.3` | 控制台编译和静态类型检查 | npm / Apache-2.0 | P4 | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`; `pkg:npm/typescript@5.9.3` |
| `vite@7.1.3` | WebView 前端开发服务器和生产 bundle | npm / MIT | P4 | `sha512-OOUi5zjkDxYrKhTV3V7iKsoS37VUM7v40+HuwEmcrsf11Cdx9y3DIr2Px6liIcZFwt3XSRpQvFpL3WVy7ApkGw==`; `pkg:npm/vite@7.1.3` |
| `vitest@3.2.4` | 控制台单元测试运行器 | npm / MIT | P4 | `sha512-LUCP5ev3GURDysTWiP47wRRUpLKMOfPh+yKTx3kVIEiu5KOMeqzpnYNsKyOoVrULivR8tLcks4+lga33Whn90A==`; `pkg:npm/vitest@3.2.4` |

API 和控制台统一固定 `typescript@5.9.3` 与 `@types/node@24.13.0`。统一版本避免 hoisted workspace 为同一路径物化两套 `undici-types`，并保证构建脚本的 Node 类型与项目锁定运行时一致。

## 6. Rust 直接依赖

引入 manifest：`apps/console/src-tauri/Cargo.toml`。所有版本使用 Cargo 的 `=x.y.z` 精确约束。

| name/version | direct scope / purpose | source/license | 权限面 | checksum / SBOM ref |
| --- | --- | --- | --- | --- |
| `tauri-build@2.4.1` | `build-dependencies`; 生成 Tauri 编译资源和元数据 | [crates.io](https://crates.io/crates/tauri-build/2.4.1) / `Apache-2.0 OR MIT` | P4 | `9c432ccc9ff661803dab74c6cd78de11026a578a9307610bbc39d3c55be7943f`; `pkg:cargo/tauri-build@2.4.1` |
| `serde@1.0.219` | `dependencies`; `derive` feature，用于壳层结构序列化 | [crates.io](https://crates.io/crates/serde/1.0.219) / `MIT OR Apache-2.0` | P1 | `5f0e2c6ed6606019b4e29e69dbaba95b11854410e5347d525002456dbbb786b6`; `pkg:cargo/serde@1.0.219` |
| `tauri@2.8.5` | `dependencies`; Windows WebView 壳、命令注册和运行时 | [crates.io](https://crates.io/crates/tauri/2.8.5) / `Apache-2.0 OR MIT` | P3 | `d4d1d3b3dc4c101ac989fd7db77e045cc6d91a25349cd410455cb5c57d510c1c`; `pkg:cargo/tauri@2.8.5` |

## 7. 项目工具链

| tool/version | purpose/source | license | integrity / traceability |
| --- | --- | --- | --- |
| `Node.js@24.13.0` | 唯一受支持的 Node 运行时；[Node.js 官方 Windows x64 archive](https://nodejs.org/dist/v24.13.0/node-v24.13.0-win-x64.zip) | MIT；archive 内第三方 notices 随分发保留 | SHA-256 `ca2742695be8de44027d71b3f53a4bdb36009b95575fe1ae6f7f0b5ce091cb88`; `pkg:generic/node@24.13.0?arch=x86_64&os=windows` |
| `npm@11.6.2` | Node archive 内置，仅由 bootstrap 用于安装锁定的 pnpm；[npm CLI](https://github.com/npm/cli) | Artistic-2.0 | 由上述 Node archive SHA-256 间接固定；不是应用包管理器 |
| `pnpm@11.19.0` | workspace 安装和脚本调度；npm registry `pnpm` 发布包 | MIT | registry SRI `sha512-eIHz7VkNRyxKlV4riLISF5ERYGbcyIy8o4SeybYPG7qm0syyIfqR2k4cZb7yvL43k2Wup6xTnHv4be3DobItzg==`; `pkg:npm/pnpm@11.19.0`。当前 `toolchain.lock.json` 只锁 name/version，bootstrap 尚未强制核对此 SRI |
| `Rust@1.88.0` | Tauri 的 `rustc`/Cargo 工具链，target `x86_64-pc-windows-msvc`；[Rust 官方分发](https://static.rust-lang.org/) | Rust 组件通常为 `MIT OR Apache-2.0`，分发包含第三方许可证 | rustup-init SHA-256 `86478e53f769379d7f0ebfa7c9aa97cb76ca92233f79aa2cc0dbee2efaac73c7`; channel manifest SHA-256 `431b7c5c0b9a511d8e31d29b378bbc74124e8521f14beb92d3a5a5f7e7e55449`; `pkg:generic/rust@1.88.0?target=x86_64-pc-windows-msvc` |

Rust profile 固定为 `minimal`，额外组件固定为 `rustfmt`、`clippy`。rustup-init 本身的语义版本没有记录在 `toolchain.lock.json`，且 bootstrap 当前未校验 `channel_manifest_sha256`；两项均列入第 8 节缺口。

## 8. 依赖选择、未采用项与发布缺口

已评估替代关系：NestJS/TypeScript 和 Tauri/React 是用户冻结技术栈，不能以 FastAPI、Electron 或第二套框架替换；`@nestjs/platform-ws` + `ws` 相比 Socket.IO 减少一层协议；class-validator 体系与 Nest DTO 管线一致，替代方案是自维护 schema 校验；Vitest 与 Vite 共用转换链，API 侧 Jest 与 Nest 测试工具链一致；Lucide 避免维护自绘图标。升级或替换任一项都要重新生成锁文件、执行契约测试并复核许可证。

以下事项尚未完成，因此当前依赖记录不能作为正式发布许可结论：

1. 已提交开发/构建 CycloneDX 文件，但尚未逐项核验 pnpm 的 679 条和 Cargo 的 462 条 lock 记录的许可证、版权 notice、维护状态及目标平台可达性，也尚未生成安装包实际携带组件的运行时专用 SBOM。
2. `pnpm@11.19.0` 的官方 registry SRI 已记录，但未进入 `config/toolchain.lock.json`，bootstrap 仍依赖 npm 在下载时自行校验；必须在工具链锁和 bootstrap 中显式校验后才能称为完全可复现。
3. Rust 锁文件校验了 crates，但 rustup-init 版本、Rust 组件 artifact hashes 和分发内第三方 notices 尚未形成发布清单；已记录的 channel manifest hash 目前也未由 bootstrap 执行校验。
4. Windows MSVC Build Tools、Windows SDK、WebView2 Runtime 仍是 Tauri 的系统前置项，尚无版本发现、最低版本、来源、许可证和构建 provenance 记录。
5. Android SDK/ADB、scrcpy 和模拟器仍只是候选 provider；在版本、来源、hash、许可证/EULA 和只读能力验证完成前，不得作为正式依赖接入。

当前仓库内 PowerShell 生成器不依赖第三方 SBOM CLI，开发/构建视角已经落盘。正式发布前仍必须生成运行时视角，只包含 API 和目标 Windows 安装包实际携带的组件，并完成两种视角的传递许可证结论；不得临时下载未锁定的 SBOM CLI 并把其输出当作验收证据。
