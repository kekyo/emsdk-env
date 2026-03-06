// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '..');

const padNumber = (value: number, length = 2) =>
  String(value).padStart(length, '0');

const formatTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hour = padNumber(date.getHours());
  const minute = padNumber(date.getMinutes());
  const second = padNumber(date.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
};

const wait = async (ms: number) =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });

const createTimestampDir = async (resultsRoot: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const timestamp = formatTimestamp(new Date());
    const timestampDir = resolve(resultsRoot, timestamp);
    if (!existsSync(timestampDir)) {
      await mkdir(timestampDir, { recursive: true });
      return timestampDir;
    }
    await wait(1000);
  }
  throw new Error('Failed to create unique timestamp directory.');
};

const createTestProject = async (targetDir: string) => {
  const packageJson = `{
  \"name\": \"emsdk-env-test\",
  \"private\": true,
  \"type\": \"module\",
  \"scripts\": {
    \"build\": \"vite build\"
  },
  \"dependencies\": {
    \"emsdk-env\": \"file:../../..\"
  },
  \"devDependencies\": {
    \"vite\": \">=5.0.0\"
  }
}
`;

  const viteConfig = `import { defineConfig } from 'vite';
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    emsdkEnv({
      generatedLoader: {
        enable: true,
      },
      common: {
        options: ['-O3', '-std=c99'],
        linkOptions: ['--no-entry'],
        linkDirectives: { STANDALONE_WASM: 1, },
      },
      targets: {
        add: {
          sources: ['add.c'],
          exports: ['_add'],
        },
      },
    }),
  ],
  build: {
    lib: {
      entry: 'entry.js',
      formats: ['es'],
      fileName: 'index',
    },
    emptyOutDir: false,
  },
});
`;

  const entryJs = `// test entry (not used in CLI test)
console.log('emsdk-env test');
`;

  const addC = `#include <stdint.h>

int add(int a, int b) {
  return a + b;
}
`;

  const runScript = `import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { WASI } from 'node:wasi';
import { loadAddWasm } from '../src/generated/wasm-loader.ts';

const wasi = new WASI({ version: 'preview1' });
const wasmBase64 = (await readFile(resolve('src', 'wasm', 'add.wasm'))).toString(
  'base64'
);
const wasm = await loadAddWasm({
  url: \`data:application/wasm;base64,\${wasmBase64}\`,
  imports: {
    wasi_snapshot_preview1: wasi.wasiImport,
  },
});

if (typeof wasm.initialize === 'function') {
  wasi.initialize(wasm.instance);
}

const add = wasm.exports.add;

if (typeof add !== 'function') {
  throw new Error('add function not found in wasm exports.');
}

const result = add(2, 3);
console.log(\`add(2, 3) = \${result}\`);
`;

  await mkdir(targetDir, { recursive: true });
  await mkdir(resolve(targetDir, 'scripts'), { recursive: true });
  await mkdir(resolve(targetDir, 'wasm'), { recursive: true });

  await writeFile(resolve(targetDir, 'package.json'), packageJson);
  await writeFile(resolve(targetDir, 'vite.config.mjs'), viteConfig);
  await writeFile(resolve(targetDir, 'entry.js'), entryJs);
  await writeFile(resolve(targetDir, 'wasm', 'add.c'), addC);
  await writeFile(resolve(targetDir, 'scripts', 'run.mjs'), runScript);
};

const runCommand = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' });

const runCommandWithOutput = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8' });

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const installDependencies = (projectDir: string) => {
  const lockFilePath = resolve(projectDir, 'package-lock.json');
  if (existsSync(lockFilePath)) {
    runCommand(npmCommand, ['ci'], projectDir);
  } else {
    runCommand(npmCommand, ['install'], projectDir);
  }
};

describe('test project generation', () => {
  test(
    'builds wasm and validates add result',
    async () => {
      const resultsRoot = resolve(workspaceRoot, 'test_results');
      const timestampDir = await createTimestampDir(resultsRoot);
      const projectDir = resolve(timestampDir, 'test_project');

      await createTestProject(projectDir);

      installDependencies(projectDir);
      runCommand(npmCommand, ['run', 'build'], projectDir);

      const output = runCommandWithOutput(
        'node',
        ['--experimental-transform-types', 'scripts/run.mjs'],
        projectDir
      );
      expect(output).toContain('add(2, 3) = 5');
    },
    20 * 60 * 1000
  );
});
