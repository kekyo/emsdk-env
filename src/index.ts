// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { spawn } from 'child_process';
import { constants, access, mkdtemp, mkdir, rename, rm } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve, isAbsolute, relative } from 'path';
import { createMutex } from 'async-primitives';
import { simpleGit, type SimpleGitOptions } from 'simple-git';
import { glob } from 'glob';
import { Logger, createConsoleLogger } from './logger';

const DEFAULT_REPO_URL = 'https://github.com/emscripten-core/emsdk.git';
const DEFAULT_GIT_REF = 'main';
const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'emsdk-env');
const DEFAULT_WASM_SRC_DIR = 'wasm';
const DEFAULT_WASM_OUT_DIR = join('src', 'wasm');
const DEFAULT_WASM_BUILD_DIR = '.wasm-build';

export type PrepareEmsdkOptions = {
  targetVersion: string;
  cacheDir?: string;
  repoUrl?: string;
  gitPath?: string;
  signal?: AbortSignal;
};

export type DefineValue = string | number | boolean;

export type WasmBuildCommonOptions = {
  options?: string[];
  linkOptions?: string[];
  includeDirs?: string[];
  defines?: Record<string, DefineValue>;
};

export type WasmBuildTarget = {
  outFile?: string;
  sources?: string[];
  options?: string[];
  linkOptions?: string[];
  includeDirs?: string[];
  defines?: Record<string, DefineValue>;
};

export type WasmBuildRule = {
  common?: WasmBuildCommonOptions;
  targets: Record<string, WasmBuildTarget>;
};

export type BuildWasmOptions = {
  emsdk: PrepareEmsdkOptions;
  rule: WasmBuildRule;
  root?: string;
  srcDir?: string;
  outDir?: string;
  buildDir?: string;
  logger?: Logger;
  signal?: AbortSignal;
};

export type BuildWasmResult = {
  emsdkRoot: string;
  outFiles: Record<string, string>;
};

const versionMutexes = new Map<string, ReturnType<typeof createMutex>>();

const getVersionMutex = (key: string) => {
  let mutex = versionMutexes.get(key);
  if (!mutex) {
    mutex = createMutex();
    versionMutexes.set(key, mutex);
  }
  return mutex;
};

const ensureNonEmpty = (value: string, label: string) => {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
};

const sanitizeSegment = (value: string) => {
  const trimmed = value.trim();
  ensureNonEmpty(trimmed, 'targetVersion');
  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
  if (sanitized === '.' || sanitized === '..' || sanitized.length === 0) {
    throw new TypeError('targetVersion results in an unsafe path segment.');
  }
  return sanitized;
};

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const runCommand = async (command: string, args: string[], cwd: string) =>
  new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Command failed: ${command} ${args.join(' ')} (exit code ${code})`
        )
      );
    });
  });

const resolveEmsdkCommand = () =>
  process.platform === 'win32' ? 'emsdk.bat' : './emsdk';

const createGitClient = (baseDir: string, gitPath: string) =>
  simpleGit({
    baseDir,
    binary: gitPath,
  } satisfies Partial<SimpleGitOptions>);

const runEmsdk = async (repoDir: string, args: string[]) => {
  if (process.platform === 'win32') {
    await runCommand('cmd', ['/c', 'emsdk.bat', ...args], repoDir);
    return;
  }
  await runCommand(resolveEmsdkCommand(), args, repoDir);
};

const ensureDirectory = async (targetPath: string) => {
  await mkdir(targetPath, { recursive: true });
};

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code !== undefined &&
  ['EEXIST', 'ENOTEMPTY', 'EISDIR'].includes(
    String((error as NodeJS.ErrnoException).code)
  );

export const prepareEmsdk = async (
  options: PrepareEmsdkOptions
): Promise<string> => {
  if (!options) {
    throw new TypeError('options must be provided.');
  }
  if (typeof options.targetVersion !== 'string') {
    throw new TypeError('targetVersion must be a string.');
  }
  ensureNonEmpty(options.targetVersion, 'targetVersion');

  const cacheDir = resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const repoUrl = options.repoUrl ?? DEFAULT_REPO_URL;
  const gitPath = options.gitPath ?? 'git';

  const versionDir = sanitizeSegment(options.targetVersion);
  const finalDir = resolve(cacheDir, versionDir);

  const mutex = getVersionMutex(finalDir);
  const lock = await mutex.lock();
  try {
    if (await pathExists(finalDir)) {
      return finalDir;
    }

    await ensureDirectory(cacheDir);

    const tempRoot = await mkdtemp(join(cacheDir, '.tmp-'));
    const tempRepoDir = join(tempRoot, 'emsdk');

    try {
      const git = createGitClient(cacheDir, gitPath);
      await git.clone(repoUrl, tempRepoDir, [
        '--depth',
        '1',
        '--branch',
        DEFAULT_GIT_REF,
      ]);
      await runEmsdk(tempRepoDir, ['install', options.targetVersion]);

      try {
        await rename(tempRepoDir, finalDir);
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          return finalDir;
        }
        throw error;
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }

    await runEmsdk(finalDir, ['activate', options.targetVersion]);
    return finalDir;
  } finally {
    lock.release();
  }
};

const ensureArray = (value?: string[]) => (value ? [...value] : []);

const mergeDefines = (
  common?: Record<string, DefineValue>,
  target?: Record<string, DefineValue>
) => ({
  ...(common ?? {}),
  ...(target ?? {}),
});

const shellQuote = (value: string) =>
  `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

const runCommandWithEnv = async (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
) =>
  new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Command failed: ${command} ${args.join(' ')} (exit code ${code})`
        )
      );
    });
  });

const runCommandCapture = async (
  command: string,
  args: string[],
  cwd: string
) =>
  new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.once('error', (error) => {
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdoutChunks));
        return;
      }
      const stderrText = Buffer.concat(stderrChunks).toString('utf8');
      rejectPromise(
        new Error(
          `Command failed: ${command} ${args.join(' ')} (exit code ${code})${
            stderrText ? `\n${stderrText}` : ''
          }`
        )
      );
    });
  });

const parseEnvBuffer = (buffer: Buffer) => {
  const entries = buffer.toString('utf8').split('\u0000');
  const env: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    const delimiterIndex = entry.indexOf('=');
    if (delimiterIndex <= 0) {
      continue;
    }
    const key = entry.slice(0, delimiterIndex);
    const value = entry.slice(delimiterIndex + 1);
    env[key] = value;
  }
  return env;
};

const loadEmsdkEnv = async (emsdkRoot: string, logger: Logger) => {
  if (process.platform === 'win32') {
    throw new Error(
      'Emscripten environment extraction on Windows is not implemented yet.'
    );
  }
  const envScript = resolve(emsdkRoot, 'emsdk_env.sh');
  if (!(await pathExists(envScript))) {
    throw new Error(`emsdk_env.sh not found: ${envScript}`);
  }
  const command = `. ${shellQuote(envScript)} >/dev/null 2>&1; env -0`;
  logger.debug(`Loading emsdk environment: ${envScript}`);
  const output = await runCommandCapture('bash', ['-lc', command], emsdkRoot);
  return parseEnvBuffer(output);
};

const resolveEmccCommand = async (
  env: Record<string, string>,
  emsdkRoot: string
) => {
  if (env.EMCC) {
    return env.EMCC;
  }
  if (env.EMSCRIPTEN) {
    const candidate = join(env.EMSCRIPTEN, 'emcc');
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  const fallback = join(emsdkRoot, 'upstream', 'emscripten', 'emcc');
  if (await pathExists(fallback)) {
    return fallback;
  }
  return 'emcc';
};

const resolvePath = (rootDir: string, value: string) =>
  isAbsolute(value) ? value : resolve(rootDir, value);

const expandPlaceholders = (
  value: string,
  env: Record<string, string>,
  label: string
) =>
  value.replace(/\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    const replacement = env[key];
    if (replacement === undefined) {
      throw new Error(`Unknown placeholder {${key}} in ${label}.`);
    }
    return replacement;
  });

const expandArray = (
  values: string[],
  env: Record<string, string>,
  label: string
) => values.map((value) => expandPlaceholders(value, env, label));

const resolveDefines = (
  defines: Record<string, DefineValue>,
  env: Record<string, string>
) => {
  const resolved: Record<string, DefineValue> = {};
  for (const [key, value] of Object.entries(defines)) {
    if (typeof value === 'string') {
      resolved[key] = expandPlaceholders(value, env, `defines.${key}`);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
};

const resolveIncludeDirs = (
  includeDirs: string[],
  env: Record<string, string>,
  rootDir: string
) => {
  const expanded = expandArray(includeDirs, env, 'includeDirs');
  return expanded.map((value) => resolvePath(rootDir, value));
};

const resolveOutFile = (
  outFile: string,
  env: Record<string, string>,
  outDir: string
) => {
  const expanded = expandPlaceholders(outFile, env, 'outFile');
  return resolvePath(outDir, expanded);
};

const resolveSourcePatterns = (
  patterns: string[],
  env: Record<string, string>,
  rootDir: string
) => {
  const expanded = expandArray(patterns, env, 'sources');
  return expanded.map((value) => resolvePath(rootDir, value));
};

const buildDefineFlags = (defines: Record<string, DefineValue>) =>
  Object.entries(defines).map(([key, value]) => `-D${key}=${String(value)}`);

const createEnvForBuild = (
  baseEnv: Record<string, string>,
  overrides: Record<string, string>
) => ({
  ...process.env,
  ...baseEnv,
  ...overrides,
});

const resolveTargetOutFile = (
  targetName: string,
  targetOutFile: string | undefined,
  env: Record<string, string>,
  outDir: string
) => {
  if (targetOutFile) {
    return resolveOutFile(targetOutFile, env, outDir);
  }
  return resolve(outDir, `${targetName}.wasm`);
};

const resolveTargetSources = async (
  targetSources: string[] | undefined,
  env: Record<string, string>,
  rootDir: string,
  srcDir: string
) => {
  const patterns =
    targetSources && targetSources.length > 0
      ? targetSources
      : [join(srcDir, '**', '*.c'), join(srcDir, '**', '*.cpp')];
  const resolvedPatterns = resolveSourcePatterns(patterns, env, rootDir);
  const results = await Promise.all(
    resolvedPatterns.map((pattern) => glob(pattern, { nodir: true }))
  );
  const sources = results.flat();
  sources.sort();
  return sources;
};

const toSafeObjectName = (rootDir: string, sourcePath: string) =>
  relative(rootDir, sourcePath)
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_');

export const buildWasm = async (
  options: BuildWasmOptions
): Promise<BuildWasmResult> => {
  if (!options) {
    throw new TypeError('options must be provided.');
  }
  if (!options.emsdk) {
    throw new TypeError('emsdk options must be provided.');
  }
  if (!options.rule || !options.rule.targets) {
    throw new TypeError('rule targets must be provided.');
  }
  const targets = Object.entries(options.rule.targets);
  if (targets.length === 0) {
    throw new TypeError('rule targets must not be empty.');
  }

  const logger = options.logger ?? createConsoleLogger('emsdk-env');
  const rootDir = resolve(options.root ?? process.cwd());

  const emsdkRoot = await prepareEmsdk(options.emsdk);
  const emsdkEnv = await loadEmsdkEnv(emsdkRoot, logger);

  const baseEnv = {
    ...emsdkEnv,
    ROOT: rootDir,
  };

  const rawSrcDir = expandPlaceholders(
    options.srcDir ?? DEFAULT_WASM_SRC_DIR,
    baseEnv,
    'srcDir'
  );
  const rawOutDir = expandPlaceholders(
    options.outDir ?? DEFAULT_WASM_OUT_DIR,
    baseEnv,
    'outDir'
  );
  const rawBuildDir = expandPlaceholders(
    options.buildDir ?? DEFAULT_WASM_BUILD_DIR,
    baseEnv,
    'buildDir'
  );

  const srcDir = resolvePath(rootDir, rawSrcDir);
  const outDir = resolvePath(rootDir, rawOutDir);
  const buildDir = resolvePath(rootDir, rawBuildDir);

  const envWithDirs = {
    ...emsdkEnv,
    ROOT: rootDir,
    SRC_DIR: srcDir,
    OUT_DIR: outDir,
    BUILD_DIR: buildDir,
  };

  const emccCommand = await resolveEmccCommand(envWithDirs, emsdkRoot);
  const common = options.rule.common ?? {};

  await ensureDirectory(outDir);
  await ensureDirectory(buildDir);

  const outFiles: Record<string, string> = {};

  for (const [targetName, target] of targets) {
    const mergedOptions = [
      ...ensureArray(common.options),
      ...ensureArray(target.options),
    ];
    const mergedLinkOptions = [
      ...ensureArray(common.linkOptions),
      ...ensureArray(target.linkOptions),
    ];
    const mergedIncludeDirs = [
      ...ensureArray(common.includeDirs),
      ...ensureArray(target.includeDirs),
    ];
    const mergedDefines = mergeDefines(common.defines, target.defines);

    const targetEnv = {
      ...envWithDirs,
      TARGET_NAME: targetName,
    };

    const resolvedOutFile = resolveTargetOutFile(
      targetName,
      target.outFile,
      targetEnv,
      outDir
    );

    const sources = await resolveTargetSources(
      target.sources,
      targetEnv,
      rootDir,
      srcDir
    );
    if (sources.length === 0) {
      throw new Error(`No sources matched for target: ${targetName}`);
    }

    const targetBuildDir = resolve(buildDir, targetName);
    await rm(targetBuildDir, { recursive: true, force: true });
    await ensureDirectory(targetBuildDir);

    const resolvedOptions = expandArray(mergedOptions, targetEnv, 'options');
    const resolvedLinkOptions = expandArray(
      mergedLinkOptions,
      targetEnv,
      'linkOptions'
    );
    const includeArgs = resolveIncludeDirs(
      mergedIncludeDirs,
      targetEnv,
      rootDir
    ).map((dir) => `-I${dir}`);
    const defineArgs = buildDefineFlags(
      resolveDefines(mergedDefines, targetEnv)
    );

    logger.info(`Compiling target: ${targetName}`);
    const objectFiles: string[] = [];
    for (const source of sources) {
      const objectName = toSafeObjectName(rootDir, source);
      const outputObject = resolve(targetBuildDir, `${objectName}.o`);
      const args = [
        '-c',
        source,
        '-o',
        outputObject,
        ...resolvedOptions,
        ...includeArgs,
        ...defineArgs,
      ];
      logger.debug(`emcc ${args.join(' ')}`);
      await runCommandWithEnv(
        emccCommand,
        args,
        rootDir,
        createEnvForBuild(targetEnv, {})
      );
      objectFiles.push(outputObject);
    }

    logger.info(`Linking target: ${targetName}`);
    const linkArgs = [
      ...objectFiles,
      '-o',
      resolvedOutFile,
      ...resolvedLinkOptions,
    ];
    logger.debug(`emcc ${linkArgs.join(' ')}`);
    await runCommandWithEnv(
      emccCommand,
      linkArgs,
      rootDir,
      createEnvForBuild(targetEnv, {})
    );

    outFiles[targetName] = resolvedOutFile;
  }

  return {
    emsdkRoot,
    outFiles,
  };
};
