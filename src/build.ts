// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { rm } from 'fs/promises';
import { glob } from 'glob';
import { isAbsolute, join, relative, resolve } from 'path';

import { runCommandWithEnv } from './commands';
import { loadEmsdkEnv, resolveEmccCommand } from './env';
import { prepareEmsdk } from './emsdk';
import { ensureDirectory } from './fs-utils';
import { createConsoleLogger } from './logger';
import type { BuildWasmOptions, BuildWasmResult, DefineValue } from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_WASM_SRC_DIR = 'wasm';
const DEFAULT_WASM_OUT_DIR = join('src', 'wasm');
const DEFAULT_WASM_BUILD_DIR = '.wasm-build';

/////////////////////////////////////////////////////////////////////////////////////////////////

const ensureArray = (value?: string[]) => (value ? [...value] : []);

const mergeDefines = (
  common?: Record<string, DefineValue>,
  target?: Record<string, DefineValue>
) => ({
  ...(common ?? {}),
  ...(target ?? {}),
});

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

const buildExportFlags = (exports: string[]) => {
  if (exports.length === 0) {
    return [];
  }
  return ['-s', `EXPORTED_FUNCTIONS=${JSON.stringify(exports)}`];
};

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

/////////////////////////////////////////////////////////////////////////////////////////////////

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
  const emsdkEnv = await loadEmsdkEnv(emsdkRoot, logger, options.emsdk.signal);

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
    const mergedExports = [
      ...ensureArray(common.exports),
      ...ensureArray(target.exports),
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
    const resolvedExports = expandArray(mergedExports, targetEnv, 'exports');
    const exportArgs = buildExportFlags(resolvedExports);
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
        createEnvForBuild(targetEnv, {}),
        options.emsdk.signal
      );
      objectFiles.push(outputObject);
    }

    logger.info(`Linking target: ${targetName}`);
    const linkArgs = [
      ...objectFiles,
      '-o',
      resolvedOutFile,
      ...resolvedLinkOptions,
      ...exportArgs,
    ];
    logger.debug(`emcc ${linkArgs.join(' ')}`);
    await runCommandWithEnv(
      emccCommand,
      linkArgs,
      rootDir,
      createEnvForBuild(targetEnv, {}),
      options.emsdk.signal
    );

    outFiles[targetName] = resolvedOutFile;
  }

  return {
    emsdkRoot,
    outFiles,
  };
};
