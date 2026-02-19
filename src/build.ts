// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { glob } from 'glob';
import { isAbsolute, join, relative, resolve } from 'path';

import { runCommandWithEnv } from './commands';
import { loadEmsdkEnv, resolveEmccCommand } from './env';
import { prepareEmsdk } from './emsdk';
import { ensureDirectory } from './fs-utils';
import { createConsoleLogger } from './logger';
import type {
  BuildWasmOptions,
  BuildWasmResult,
  DefineValue,
  PrepareEmsdkOptions,
} from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_WASM_SRC_DIR = 'wasm';
const DEFAULT_WASM_OUT_DIR = join('src', 'wasm');
const DEFAULT_WASM_BUILD_DIR = join(tmpdir(), 'emsdk-env');
const DEFAULT_EMSDK_TARGET_VERSION = 'latest';

/////////////////////////////////////////////////////////////////////////////////////////////////

let buildSequence = 0;

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

const createBuildId = () => {
  buildSequence += 1;
  const timestamp = formatTimestamp(new Date());
  const seq = String(buildSequence).padStart(4, '0');
  return `${timestamp}_${seq}_${process.pid}`;
};

const ensureArray = (value?: string[]) => (value ? [...value] : []);

const normalizePrepareOptions = (
  options: PrepareEmsdkOptions | undefined
): PrepareEmsdkOptions => {
  const { targetVersion, ...rest } = options ?? {};
  return {
    targetVersion: targetVersion ?? DEFAULT_EMSDK_TARGET_VERSION,
    ...rest,
  };
};

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

const resolveSourcesFromPatterns = async (
  patterns: string[],
  env: Record<string, string>,
  srcDir: string,
  label: string
) => {
  const expanded = expandArray(patterns, env, label);
  const resolvedPatterns = expanded.map((value) => resolvePath(srcDir, value));
  const results = await Promise.all(
    resolvedPatterns.map((pattern) => glob(pattern, { nodir: true }))
  );
  const sources = results.flat();
  sources.sort();
  return sources;
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
  srcDir: string
) => {
  const patterns =
    targetSources && targetSources.length > 0
      ? targetSources
      : [join(srcDir, '**', '*.c'), join(srcDir, '**', '*.cpp')];
  return resolveSourcesFromPatterns(patterns, env, srcDir, 'sources');
};

const toSafeObjectName = (
  rootDir: string,
  sourcePath: string,
  groupIndex?: number
) => {
  const baseName = relative(rootDir, sourcePath)
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_');
  if (groupIndex === undefined) {
    return baseName;
  }
  return `${baseName}__g${groupIndex}`;
};

const dedupeSources = (sources: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const source of sources) {
    if (seen.has(source)) {
      continue;
    }
    seen.add(source);
    deduped.push(source);
  }
  return deduped;
};

type CompileArgs = {
  resolvedOptions: string[];
  includeArgs: string[];
  defineArgs: string[];
};

const buildCompileArgs = (
  options: string[],
  includeDirs: string[],
  defines: Record<string, DefineValue>,
  env: Record<string, string>,
  rootDir: string
): CompileArgs => {
  const resolvedOptions = expandArray(options, env, 'options');
  const includeArgs = resolveIncludeDirs(includeDirs, env, rootDir).map(
    (dir) => `-I${dir}`
  );
  const defineArgs = buildDefineFlags(resolveDefines(defines, env));
  return { resolvedOptions, includeArgs, defineArgs };
};

/////////////////////////////////////////////////////////////////////////////////////////////////

export const buildWasm = async (
  options: BuildWasmOptions
): Promise<BuildWasmResult> => {
  if (!options) {
    throw new TypeError('options must be provided.');
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

  const emsdkOptions = normalizePrepareOptions(options.emsdk);
  const emsdkRoot = await prepareEmsdk(emsdkOptions);
  const emsdkEnv = await loadEmsdkEnv(emsdkRoot, logger, emsdkOptions.signal);

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
  const buildId = createBuildId();
  const buildRunDir = resolve(buildDir, buildId);
  const cleanupBuildDir = options.cleanupBuildDir ?? true;
  const parallel = options.parallel ?? true;

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
  await rm(buildRunDir, { recursive: true, force: true });
  await ensureDirectory(buildRunDir);

  const outFiles: Record<string, string> = {};

  try {
    for (const [targetName, target] of targets) {
      const mergedLinkOptions = [
        ...ensureArray(common.linkOptions),
        ...ensureArray(target.linkOptions),
      ];
      const mergedExports = [
        ...ensureArray(common.exports),
        ...ensureArray(target.exports),
      ];
      const baseCompileOptions = [
        ...ensureArray(common.options),
        ...ensureArray(target.options),
      ];
      const baseIncludeDirs = [
        ...ensureArray(common.includeDirs),
        ...ensureArray(target.includeDirs),
      ];
      const baseDefines = mergeDefines(common.defines, target.defines);
      const sourceGroups = target.sourceGroups ?? [];

      const targetEnv = {
        ...envWithDirs,
        TARGET_NAME: targetName,
      };
      const buildEnv = createEnvForBuild(targetEnv, {});

      const resolvedOutFile = resolveTargetOutFile(
        targetName,
        target.outFile,
        targetEnv,
        outDir
      );

      const sources = await resolveTargetSources(
        target.sources,
        targetEnv,
        srcDir
      );
      const groupSources: string[][] = sourceGroups.map(() => []);
      const groupSourceSet = new Set<string>();
      for (let index = 0; index < sourceGroups.length; index += 1) {
        const group = sourceGroups[index];
        if (!group) {
          continue;
        }
        const resolved = await resolveSourcesFromPatterns(
          group.sources,
          targetEnv,
          srcDir,
          `sourceGroups[${index}].sources`
        );
        const deduped = dedupeSources(resolved);
        groupSources[index] = deduped;
        for (const source of deduped) {
          groupSourceSet.add(source);
        }
      }
      const baseSources = sources.filter(
        (source) => !groupSourceSet.has(source)
      );
      const groupedSources = groupSources.flat();
      if (baseSources.length + groupedSources.length === 0) {
        throw new Error(`No sources matched for target: ${targetName}`);
      }

      const targetBuildDir = resolve(buildRunDir, targetName);
      await rm(targetBuildDir, { recursive: true, force: true });
      await ensureDirectory(targetBuildDir);

      const resolvedLinkOptions = expandArray(
        mergedLinkOptions,
        targetEnv,
        'linkOptions'
      );
      const resolvedExports = expandArray(mergedExports, targetEnv, 'exports');
      const exportArgs = buildExportFlags(resolvedExports);
      const baseCompileArgs = buildCompileArgs(
        baseCompileOptions,
        baseIncludeDirs,
        baseDefines,
        targetEnv,
        rootDir
      );
      const groupCompileArgs = sourceGroups.map((group) => {
        const groupOptions = [
          ...baseCompileOptions,
          ...ensureArray(group?.options),
        ];
        const groupIncludeDirs = [
          ...baseIncludeDirs,
          ...ensureArray(group?.includeDirs),
        ];
        const groupDefines = mergeDefines(baseDefines, group?.defines ?? {});
        return buildCompileArgs(
          groupOptions,
          groupIncludeDirs,
          groupDefines,
          targetEnv,
          rootDir
        );
      });

      logger.info(`Compiling target: ${targetName}`);
      const compileSource = async (
        source: string,
        args: CompileArgs,
        groupIndex: number | undefined
      ) => {
        const objectName = toSafeObjectName(rootDir, source, groupIndex);
        const outputObject = resolve(targetBuildDir, `${objectName}.o`);
        const compileArgs = [
          '-c',
          source,
          '-o',
          outputObject,
          ...args.resolvedOptions,
          ...args.includeArgs,
          ...args.defineArgs,
        ];
        logger.debug(`emcc ${compileArgs.join(' ')}`);
        await runCommandWithEnv(
          emccCommand,
          compileArgs,
          rootDir,
          buildEnv,
          emsdkOptions.signal
        );
        return outputObject;
      };
      const buildObjectsSequential = async () => {
        const objectFiles: string[] = [];
        for (const source of baseSources) {
          objectFiles.push(
            await compileSource(source, baseCompileArgs, undefined)
          );
        }
        for (let index = 0; index < groupSources.length; index += 1) {
          const sourcesInGroup = groupSources[index];
          if (!sourcesInGroup) {
            continue;
          }
          const groupArgs = groupCompileArgs[index];
          if (!groupArgs) {
            continue;
          }
          for (const source of sourcesInGroup) {
            objectFiles.push(await compileSource(source, groupArgs, index));
          }
        }
        return objectFiles;
      };
      const compileJobs: Array<{
        source: string;
        args: CompileArgs;
        groupIndex: number | undefined;
      }> = [];
      for (const source of baseSources) {
        compileJobs.push({
          source,
          args: baseCompileArgs,
          groupIndex: undefined,
        });
      }
      for (let index = 0; index < groupSources.length; index += 1) {
        const sourcesInGroup = groupSources[index];
        if (!sourcesInGroup) {
          continue;
        }
        const groupArgs = groupCompileArgs[index];
        if (!groupArgs) {
          continue;
        }
        for (const source of sourcesInGroup) {
          compileJobs.push({ source, args: groupArgs, groupIndex: index });
        }
      }
      const objectFiles = parallel
        ? await Promise.all(
            compileJobs.map((job) =>
              compileSource(job.source, job.args, job.groupIndex)
            )
          )
        : await buildObjectsSequential();

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
        buildEnv,
        emsdkOptions.signal
      );

      outFiles[targetName] = resolvedOutFile;
    }
  } finally {
    if (cleanupBuildDir) {
      await rm(buildRunDir, { recursive: true, force: true });
    }
  }

  return {
    emsdkRoot,
    outFiles,
  };
};
