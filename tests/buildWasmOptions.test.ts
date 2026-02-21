// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { mkdtemp, mkdir, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, parse, resolve } from 'path';
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
  resolveEmarCommand: vi.fn().mockResolvedValue('emar'),
  resolveWasmOptCommand: vi.fn().mockResolvedValue('wasm-opt'),
}));

vi.mock('../src/commands', () => ({
  runCommandWithEnv: vi.fn(async (command: string, args: string[]) => {
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
    let outFile: string | undefined;
    const isCompile = args.includes('-c');
    const outIndex = args.indexOf('-o');
    if (outIndex !== -1) {
      outFile = args[outIndex + 1];
    } else if (args[0] === 'rcs') {
      outFile = args[1];
    }
    if (!outFile) {
      return;
    }
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, 'mock');
    if (command === 'emcc' && !isCompile) {
      const parsed = parse(outFile);
      if (parsed.ext.toLowerCase() !== '.wasm') {
        const baseName = parsed.name.toLowerCase().endsWith('.wasm')
          ? parsed.name
          : `${parsed.name}.wasm`;
        const wasmFile = join(parsed.dir, baseName);
        await writeFile(wasmFile, 'mock');
      }
      let wasmBinaryFile: string | undefined;
      const extractWasmBinaryFile = (value: string) => {
        if (value.startsWith('WASM_BINARY_FILE=')) {
          return value.slice('WASM_BINARY_FILE='.length);
        }
        const match = value.match(
          /^(?:-s|--settings)(?:=)?WASM_BINARY_FILE=(.+)$/
        );
        return match ? match[1] : undefined;
      };
      for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        if (!option) {
          continue;
        }
        if (option === '-s' || option === '--settings') {
          const next = args[index + 1];
          const extracted = next ? extractWasmBinaryFile(next) : undefined;
          if (extracted) {
            wasmBinaryFile = extracted;
            break;
          }
        }
        const extracted = extractWasmBinaryFile(option);
        if (extracted) {
          wasmBinaryFile = extracted;
          break;
        }
      }
      if (wasmBinaryFile) {
        const normalized = wasmBinaryFile
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2');
        const wasmFile = resolve(parsed.dir, normalized);
        await writeFile(wasmFile, 'mock');
      }
    }
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

  test('builds archive outputs into libDir', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      const result = await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            libalpha: {
              type: 'archive',
              sources: ['alpha.c'],
            },
          },
        },
      });

      const expectedArchive = resolve(projectRoot, 'lib', 'libalpha.a');
      expect(result.outFiles.libalpha).toBe(expectedArchive);

      const archiveCall = runCommandMock.mock.calls.find(
        (call) => call[0] === 'emar'
      );
      expect(archiveCall).toBeTruthy();
      const archiveArgs = (archiveCall?.[1] ?? []) as string[];
      expect(archiveArgs[0]).toBe('rcs');
      expect(archiveArgs[1]).toBe(expectedArchive);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('adds libDir to wasm link args', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        libDir: 'custom-lib',
        rule: {
          targets: {
            app: {},
          },
        },
      });

      const linkCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return (
          Array.isArray(args) && args.includes('-o') && !args.includes('-c')
        );
      });
      const linkArgs = linkCalls[0]?.[1] as string[] | undefined;
      expect(linkArgs).toBeTruthy();
      expect(linkArgs).toContain(`-L${resolve(projectRoot, 'custom-lib')}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('rejects linkOptions for archive target', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      await expect(
        buildWasm({
          root: projectRoot,
          buildDir: join(projectRoot, '.wasm-build'),
          rule: {
            targets: {
              libalpha: {
                type: 'archive',
                linkOptions: ['-s', 'ALLOW_MEMORY_GROWTH=1'],
              },
            },
          },
        })
      ).rejects.toThrow('linkOptions is not supported for archive target');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('rejects exports for archive target', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      await expect(
        buildWasm({
          root: projectRoot,
          buildDir: join(projectRoot, '.wasm-build'),
          rule: {
            targets: {
              libalpha: {
                type: 'archive',
                exports: ['_alpha'],
              },
            },
          },
        })
      ).rejects.toThrow('exports is not supported for archive target');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('rejects wasmOpt for archive target', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      await expect(
        buildWasm({
          root: projectRoot,
          buildDir: join(projectRoot, '.wasm-build'),
          rule: {
            targets: {
              libalpha: {
                type: 'archive',
                wasmOpt: {
                  enable: true,
                },
              },
            },
          },
        })
      ).rejects.toThrow('wasmOpt is not supported for archive target');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('ignores common linkOptions and exports for archive targets', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    try {
      const result = await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          common: {
            linkOptions: ['-s', 'ALLOW_MEMORY_GROWTH=1'],
            exports: ['_common'],
          },
          targets: {
            libalpha: {
              type: 'archive',
              sources: ['alpha.c'],
            },
          },
        },
      });

      expect(result.outFiles.libalpha).toBe(
        resolve(projectRoot, 'lib', 'libalpha.a')
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('runs wasm-opt with default args when enabled', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            app: {
              wasmOpt: {
                enable: true,
              },
            },
          },
        },
      });

      const wasmOptCalls = runCommandMock.mock.calls.filter(
        (call) => call[0] === 'wasm-opt'
      );
      expect(wasmOptCalls.length).toBe(1);
      const wasmOptArgs = wasmOptCalls[0]?.[1] as string[] | undefined;
      expect(wasmOptArgs).toBeTruthy();
      const outFile = resolve(projectRoot, 'src/wasm/app.wasm');
      expect(wasmOptArgs?.[0]).toBe(outFile);
      expect(wasmOptArgs).toContain('-o');
      expect(wasmOptArgs).toContain(`${outFile}.opt`);
      expect(wasmOptArgs).toContain('-Oz');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('runs wasm-opt against wasm output when js module is emitted', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            app: {
              outFile: 'app.mjs',
              linkOptions: ['-s', 'EXPORT_ES6=1'],
              wasmOpt: {
                enable: true,
              },
            },
          },
        },
      });

      const wasmOptCalls = runCommandMock.mock.calls.filter(
        (call) => call[0] === 'wasm-opt'
      );
      expect(wasmOptCalls.length).toBe(1);
      const wasmOptArgs = wasmOptCalls[0]?.[1] as string[] | undefined;
      expect(wasmOptArgs).toBeTruthy();
      const wasmFile = resolve(projectRoot, 'src/wasm/app.wasm');
      expect(wasmOptArgs?.[0]).toBe(wasmFile);
      expect(wasmOptArgs).toContain('-o');
      expect(wasmOptArgs).toContain(`${wasmFile}.opt`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('uses WASM_BINARY_FILE when resolving wasm-opt input', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            app: {
              outFile: 'app.mjs',
              linkOptions: [
                '-s',
                'EXPORT_ES6=1',
                '-s',
                'WASM_BINARY_FILE=custom.wasm',
              ],
              wasmOpt: {
                enable: true,
              },
            },
          },
        },
      });

      const wasmOptCalls = runCommandMock.mock.calls.filter(
        (call) => call[0] === 'wasm-opt'
      );
      expect(wasmOptCalls.length).toBe(1);
      const wasmOptArgs = wasmOptCalls[0]?.[1] as string[] | undefined;
      expect(wasmOptArgs).toBeTruthy();
      const wasmFile = resolve(projectRoot, 'src/wasm/custom.wasm');
      expect(wasmOptArgs?.[0]).toBe(wasmFile);
      expect(wasmOptArgs).toContain('-o');
      expect(wasmOptArgs).toContain(`${wasmFile}.opt`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('merges common and target wasmOpt args', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          common: {
            wasmOpt: {
              args: ['--strip-debug'],
            },
          },
          targets: {
            app: {
              wasmOpt: {
                enable: true,
                args: ['--dce'],
              },
            },
          },
        },
      });

      const wasmOptCalls = runCommandMock.mock.calls.filter(
        (call) => call[0] === 'wasm-opt'
      );
      expect(wasmOptCalls.length).toBe(1);
      const wasmOptArgs = wasmOptCalls[0]?.[1] as string[] | undefined;
      expect(wasmOptArgs).toBeTruthy();
      const stripIndex = wasmOptArgs?.indexOf('--strip-debug') ?? -1;
      const dceIndex = wasmOptArgs?.indexOf('--dce') ?? -1;
      expect(stripIndex).toBeGreaterThan(-1);
      expect(dceIndex).toBeGreaterThan(-1);
      expect(stripIndex).toBeLessThan(dceIndex);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('expands placeholders in wasmOpt args', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          common: {
            wasmOpt: {
              args: ['--tag={TARGET_NAME}'],
            },
          },
          targets: {
            app: {
              wasmOpt: {
                enable: true,
              },
            },
          },
        },
      });

      const wasmOptCalls = runCommandMock.mock.calls.filter(
        (call) => call[0] === 'wasm-opt'
      );
      expect(wasmOptCalls.length).toBe(1);
      const wasmOptArgs = wasmOptCalls[0]?.[1] as string[] | undefined;
      expect(wasmOptArgs).toContain('--tag=app');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('propagates wasm-opt failure', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    const originalImplementation = runCommandMock.getMockImplementation();
    runCommandMock.mockImplementation(
      async (command, args, cwd, env, signal) => {
        if (command === 'wasm-opt') {
          throw new Error('wasm-opt failed');
        }
        if (!originalImplementation) {
          return;
        }
        return originalImplementation(command, args, cwd, env, signal);
      }
    );

    try {
      await expect(
        buildWasm({
          root: projectRoot,
          buildDir: join(projectRoot, '.wasm-build'),
          rule: {
            targets: {
              app: {
                wasmOpt: {
                  enable: true,
                },
              },
            },
          },
        })
      ).rejects.toThrow('wasm-opt failed');
    } finally {
      if (originalImplementation) {
        runCommandMock.mockImplementation(originalImplementation);
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('uses default includeDir when common includeDirs is omitted', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          targets: {
            app: {},
          },
        },
      });

      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return Array.isArray(args) && args.includes('-c');
      });
      expect(
        compileCalls.some((call) =>
          (call[1] as string[]).includes(`-I${resolve(projectRoot, 'include')}`)
        )
      ).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('does not add includeDir when common includeDirs is specified', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        rule: {
          common: {
            includeDirs: [],
          },
          targets: {
            app: {},
          },
        },
      });

      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return Array.isArray(args) && args.includes('-c');
      });
      expect(
        compileCalls.some((call) =>
          (call[1] as string[]).includes(`-I${resolve(projectRoot, 'include')}`)
        )
      ).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('adds import include and lib directories', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const packageDir = join(projectRoot, 'node_modules', 'foo');
    await mkdir(join(packageDir, 'include'), { recursive: true });
    await mkdir(join(packageDir, 'lib'), { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'foo', version: '1.0.0' })
    );
    await writeFile(join(packageDir, 'index.js'), 'module.exports = {};');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        imports: ['foo'],
        rule: {
          targets: {
            app: {},
          },
        },
      });

      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return Array.isArray(args) && args.includes('-c');
      });
      expect(
        compileCalls.some((call) =>
          (call[1] as string[]).includes(`-I${resolve(packageDir, 'include')}`)
        )
      ).toBe(true);

      const linkCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return (
          Array.isArray(args) && args.includes('-o') && !args.includes('-c')
        );
      });
      expect(
        linkCalls.some((call) =>
          (call[1] as string[]).includes(`-L${resolve(packageDir, 'lib')}`)
        )
      ).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('uses emsdk-env config for import directories', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const packageDir = join(projectRoot, 'node_modules', 'foo');
    await mkdir(join(packageDir, 'inc'), { recursive: true });
    await mkdir(join(packageDir, 'library'), { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'foo',
        version: '1.0.0',
        'emsdk-env': {
          include: 'inc',
          lib: 'library',
        },
      })
    );
    await writeFile(join(packageDir, 'index.js'), 'module.exports = {};');

    const runCommandMock = vi.mocked(runCommandWithEnv);
    runCommandMock.mockClear();

    try {
      await buildWasm({
        root: projectRoot,
        buildDir: join(projectRoot, '.wasm-build'),
        imports: ['foo'],
        rule: {
          targets: {
            app: {},
          },
        },
      });

      const compileCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return Array.isArray(args) && args.includes('-c');
      });
      expect(
        compileCalls.some((call) =>
          (call[1] as string[]).includes(`-I${resolve(packageDir, 'inc')}`)
        )
      ).toBe(true);

      const linkCalls = runCommandMock.mock.calls.filter((call) => {
        const args = call[1] as string[] | undefined;
        return (
          Array.isArray(args) && args.includes('-o') && !args.includes('-c')
        );
      });
      expect(
        linkCalls.some((call) =>
          (call[1] as string[]).includes(`-L${resolve(packageDir, 'library')}`)
        )
      ).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('fails when import directories are missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    await mkdir(wasmDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');

    const packageDir = join(projectRoot, 'node_modules', 'foo');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'foo', version: '1.0.0' })
    );
    await writeFile(join(packageDir, 'index.js'), 'module.exports = {};');

    try {
      await expect(
        buildWasm({
          root: projectRoot,
          buildDir: join(projectRoot, '.wasm-build'),
          imports: ['foo'],
          rule: {
            targets: {
              app: {},
            },
          },
        })
      ).rejects.toThrow('does not provide include or lib directories');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
