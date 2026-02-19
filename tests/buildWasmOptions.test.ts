// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { mkdtemp, mkdir, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildWasm } from '../src/build';
import { runCommandWithEnv } from '../src/commands';
import { prepareEmsdk } from '../src/emsdk';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultBuildRoot = join(tmpdir(), 'emsdk-env');

let compileConcurrency = 0;
let maxCompileConcurrency = 0;
let compileDelayMs = 0;

beforeEach(() => {
  compileConcurrency = 0;
  maxCompileConcurrency = 0;
  compileDelayMs = 0;
});

vi.mock('../src/emsdk', () => ({
  prepareEmsdk: vi.fn().mockResolvedValue('/mock/emsdk'),
}));

vi.mock('../src/env', () => ({
  loadEmsdkEnv: vi.fn().mockResolvedValue({}),
  resolveEmccCommand: vi.fn().mockResolvedValue('emcc'),
}));

vi.mock('../src/commands', () => ({
  runCommandWithEnv: vi.fn(async (_command: string, args: string[]) => {
    if (args.includes('-c')) {
      compileConcurrency += 1;
      maxCompileConcurrency = Math.max(
        maxCompileConcurrency,
        compileConcurrency
      );
      try {
        if (compileDelayMs > 0) {
          await wait(compileDelayMs);
        }
      } finally {
        compileConcurrency -= 1;
      }
    }
    const outIndex = args.indexOf('-o');
    if (outIndex === -1) {
      return;
    }
    const outFile = args[outIndex + 1];
    if (!outFile) {
      return;
    }
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, 'mock');
  }),
}));

describe('buildWasm options', () => {
  test('defaults emsdk when omitted', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      const result = await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            alpha: {},
          },
        },
      });

      expect(result.emsdkRoot).toBe('/mock/emsdk');
      expect(result.outFiles.alpha).toBe(
        resolve(projectRoot, 'src/wasm/alpha.wasm')
      );

      const prepareMock = vi.mocked(prepareEmsdk);
      expect(prepareMock).toHaveBeenCalledTimes(1);
      expect(prepareMock).toHaveBeenCalledWith({
        targetVersion: 'latest',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('cleans build directory by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      await rm(defaultBuildRoot, { recursive: true, force: true });
      await buildWasm({
        root: projectRoot,
        rule: {
          targets: {
            alpha: {},
          },
        },
      });

      const buildRoot = defaultBuildRoot;
      const entries = await readdir(buildRoot);
      expect(entries.length).toBe(0);
    } finally {
      await rm(defaultBuildRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('keeps build directory when cleanup is disabled', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        cleanupBuildDir: false,
        rule: {
          targets: {
            alpha: {},
          },
        },
      });

      const buildRoot = resolve(projectRoot, '.wasm-build');
      const entries = await readdir(buildRoot);
      expect(entries.length).toBe(1);
      expect(entries[0]).toMatch(/^\d{8}_\d{6}_\d{4}_\d+$/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('compiles sources in parallel by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');
    await writeFile(join(wasmDir, 'beta.c'), 'int beta() { return 2; }');

    try {
      compileDelayMs = 50;
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            alpha: {},
          },
        },
      });

      expect(maxCompileConcurrency).toBeGreaterThan(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('compiles sources sequentially when parallel is false', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');
    await writeFile(join(wasmDir, 'beta.c'), 'int beta() { return 2; }');

    try {
      compileDelayMs = 50;
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        parallel: false,
        rule: {
          targets: {
            alpha: {},
          },
        },
      });

      expect(maxCompileConcurrency).toBe(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('applies sourceGroups compile options and overrides base sources', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');
    await writeFile(join(wasmDir, 'beta.c'), 'int beta() { return 2; }');
    await writeFile(join(wasmDir, 'gamma.c'), 'int gamma() { return 3; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          common: {
            options: ['-O1'],
          },
          targets: {
            app: {
              sources: ['alpha.c', 'beta.c'],
              options: ['-O2'],
              sourceGroups: [
                {
                  sources: ['beta.c', 'gamma.c'],
                  options: ['-O3'],
                  defines: {
                    GROUP: 1,
                  },
                },
              ],
            },
          },
        },
      });

      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return Array.isArray(args) && args.includes('-c');
      });

      const alphaPath = resolve(projectRoot, 'wasm', 'alpha.c');
      const betaPath = resolve(projectRoot, 'wasm', 'beta.c');
      const gammaPath = resolve(projectRoot, 'wasm', 'gamma.c');

      const alphaCalls = compileCalls.filter((call) =>
        (call[1] as string[]).includes(alphaPath)
      );
      const betaCalls = compileCalls.filter((call) =>
        (call[1] as string[]).includes(betaPath)
      );
      const gammaCalls = compileCalls.filter((call) =>
        (call[1] as string[]).includes(gammaPath)
      );

      expect(alphaCalls.length).toBe(1);
      expect(betaCalls.length).toBe(1);
      expect(gammaCalls.length).toBe(1);

      const alphaArgs = alphaCalls[0]?.[1] as string[];
      const betaArgs = betaCalls[0]?.[1] as string[];
      const gammaArgs = gammaCalls[0]?.[1] as string[];

      expect(alphaArgs).toContain('-O1');
      expect(alphaArgs).toContain('-O2');
      expect(alphaArgs).not.toContain('-O3');
      expect(alphaArgs).not.toContain('-DGROUP=1');

      expect(betaArgs).toContain('-O1');
      expect(betaArgs).toContain('-O2');
      expect(betaArgs).toContain('-O3');
      expect(betaArgs).toContain('-DGROUP=1');

      expect(gammaArgs).toContain('-O1');
      expect(gammaArgs).toContain('-O2');
      expect(gammaArgs).toContain('-O3');
      expect(gammaArgs).toContain('-DGROUP=1');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('allows overlapping sources across sourceGroups with unique objects', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      const runCommandMock = vi.mocked(runCommandWithEnv);
      runCommandMock.mockClear();

      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            app: {
              sourceGroups: [
                {
                  sources: ['alpha.c'],
                  options: ['-O2'],
                },
                {
                  sources: ['alpha.c'],
                  options: ['-O3'],
                },
              ],
            },
          },
        },
      });

      const alphaPath = resolve(projectRoot, 'wasm', 'alpha.c');
      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return (
          Array.isArray(args) && args.includes('-c') && args.includes(alphaPath)
        );
      });

      expect(compileCalls.length).toBe(2);

      const outputPaths = compileCalls.map((call) => {
        const args = call[1] as string[];
        const outIndex = args.indexOf('-o');
        if (outIndex < 0) {
          return '';
        }
        return args[outIndex + 1] ?? '';
      });

      expect(outputPaths.some((path) => path.includes('__g0.o'))).toBe(true);
      expect(outputPaths.some((path) => path.includes('__g1.o'))).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
