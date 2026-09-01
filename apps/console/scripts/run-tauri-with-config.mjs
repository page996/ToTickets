import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateTauriConfigOverlay } from './tauri-config-overlay.mjs';

const [command, ...commandArguments] = process.argv.slice(2);
const supportedCommands = new Set(['build', 'dev']);

if (!supportedCommands.has(command)) {
  throw new Error('the configured Tauri wrapper supports only the build and dev commands');
}
if (commandArguments.some((argument) => argument === '--config' || argument.startsWith('--config='))) {
  throw new Error('a caller-supplied Tauri config is not allowed; the wrapper generates it');
}

const { outputPath } = await generateTauriConfigOverlay();
const resolveProjectDependency = createRequire(import.meta.url);
let cliEntryPath;
try {
  cliEntryPath = resolveProjectDependency.resolve('@tauri-apps/cli/tauri.js');
} catch {
  throw new Error('the project-local @tauri-apps/cli dependency is unavailable');
}

const child = spawn(
  process.execPath,
  [cliEntryPath, command, '--config', outputPath, ...commandArguments],
  {
    env: process.env,
    shell: false,
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) {
      reject(new Error(`Tauri terminated by signal ${signal}`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
