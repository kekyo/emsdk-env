// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { readFile, rename, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { glob } from 'glob';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'path';

import { runCommandWithEnv } from './commands';
import {
  loadEmsdkEnv,
  resolveEmarCommand,
  resolveEmccCommand,
  resolveWasmOptCommand,
} from './env';
import { prepareEmsdk } from './emsdk';
import { ensureDirectory, pathExists } from './fs-utils';
import { createConsoleLogger } from './logger';
import type {
  BuildWasmOptions,
  BuildWasmResult,
  DefineValue,
  KeyValueInput,
  PrepareEmsdkOptions,
  WasmOptOptions,
  WasmBuildTargetType,
} from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_WASM_SRC_DIR = 'wasm';
const DEFAULT_WASM_INCLUDE_DIR = 'include';
const DEFAULT_WASM_OUT_DIR = join('src', 'wasm');
const DEFAULT_WASM_LIB_DIR = 'lib';
const DEFAULT_IMPORT_INCLUDE_DIR = 'include';
const DEFAULT_IMPORT_LIB_DIR = 'lib';
const DEFAULT_WASM_BUILD_DIR = join(tmpdir(), 'emsdk-env');
const DEFAULT_EMSDK_TARGET_VERSION = 'latest';
const DEFAULT_WASM_OPT_ARGS = ['-Oz'];

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

const ensureArray = (value?: readonly string[]) => value ?? [];

const resolveTargetType = (value: WasmBuildTargetType | undefined) =>
  value ?? 'wasm';

const normalizePrepareOptions = (
  options: PrepareEmsdkOptions | undefined
): PrepareEmsdkOptions => {
  const { targetVersion, ...rest } = options ?? {};
  return {
    targetVersion: targetVersion ?? DEFAULT_EMSDK_TARGET_VERSION,
    ...rest,
  };
};

const parseKeyValueInput = (values: readonly string[]) => {
  const parsed: Record<string, DefineValue> = {};
  for (const entry of values) {
    const index = entry.indexOf('=');
    if (index === -1) {
      parsed[entry] = undefined;
      continue;
    }
    const key = entry.slice(0, index);
    const value = entry.slice(index + 1);
    parsed[key] = value;
  }
  return parsed;
};

const isKeyValueMap = (
  value: KeyValueInput
): value is Readonly<Map<string, DefineValue>> => value instanceof Map;

const normalizeKeyValueInput = (
  input: KeyValueInput | undefined
): Record<string, DefineValue> => {
  if (!input) {
    return {};
  }
  if (Array.isArray(input)) {
    return parseKeyValueInput(input);
  }
  if (isKeyValueMap(input)) {
    return Object.fromEntries(input);
  }
  return { ...(input as Record<string, DefineValue>) };
};

const mergeDefines = (
  common?: KeyValueInput,
  target?: KeyValueInput
): Record<string, DefineValue> => ({
  ...normalizeKeyValueInput(common),
  ...normalizeKeyValueInput(target),
});

const mergeLinkDirectives = (common?: KeyValueInput, target?: KeyValueInput) =>
  mergeDefines(common, target);

const resolveWasmOptEnabled = (
  common: WasmOptOptions | undefined,
  target: WasmOptOptions | undefined
) => target?.enable ?? common?.enable ?? false;

const resolveWasmOptArgs = (
  common: WasmOptOptions | undefined,
  target: WasmOptOptions | undefined,
  env: Record<string, string>
) => {
  const commonArgs = common?.options ?? DEFAULT_WASM_OPT_ARGS;
  const targetArgs = target?.options ?? [];
  const mergedArgs = [...commonArgs, ...targetArgs];
  return expandArray(mergedArgs, env, 'wasmOpt.options');
};

const stripOuterQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const extractWasmBinaryFile = (value: string) => {
  if (value.startsWith('WASM_BINARY_FILE=')) {
    return value.slice('WASM_BINARY_FILE='.length);
  }
  const match = value.match(/^(?:-s|--settings)(?:=)?WASM_BINARY_FILE=(.+)$/);
  if (match) {
    return match[1];
  }
  return undefined;
};

const resolveWasmBinaryFileFromLinkOptions = (
  linkOptions: readonly string[]
) => {
  for (let index = 0; index < linkOptions.length; index += 1) {
    const option = linkOptions[index];
    if (!option) {
      continue;
    }
    if (option === '-s' || option === '--settings') {
      const next = linkOptions[index + 1];
      if (!next) {
        continue;
      }
      const extracted = extractWasmBinaryFile(next);
      if (extracted) {
        return stripOuterQuotes(extracted);
      }
    }
    const extracted = extractWasmBinaryFile(option);
    if (extracted) {
      return stripOuterQuotes(extracted);
    }
  }
  return undefined;
};

const resolveWasmOptInputFile = (
  resolvedOutFile: string,
  resolvedLinkOptions: readonly string[]
) => {
  const wasmBinaryFile =
    resolveWasmBinaryFileFromLinkOptions(resolvedLinkOptions);
  if (wasmBinaryFile) {
    return isAbsolute(wasmBinaryFile)
      ? wasmBinaryFile
      : resolve(dirname(resolvedOutFile), wasmBinaryFile);
  }
  const parsed = parse(resolvedOutFile);
  if (parsed.ext.toLowerCase() === '.wasm') {
    return resolvedOutFile;
  }
  const baseName = parsed.name.toLowerCase().endsWith('.wasm')
    ? parsed.name
    : `${parsed.name}.wasm`;
  return join(parsed.dir, baseName);
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
  values: readonly string[],
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

const resolveLinkDirectives = (
  directives: Record<string, DefineValue>,
  env: Record<string, string>
) => {
  const resolved: Record<string, DefineValue> = {};
  for (const [key, value] of Object.entries(directives)) {
    if (typeof value === 'string') {
      resolved[key] = expandPlaceholders(value, env, `linkDirectives.${key}`);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
};

const resolveIncludeDirs = (
  includeDirs: readonly string[],
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
  patterns: readonly string[],
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
  Object.entries(defines).flatMap(([key, value]) =>
    value === null || value === undefined
      ? [`-D${key}`]
      : [`-D${key}=${String(value)}`]
  );

const buildLinkDirectiveFlags = (directives: Record<string, DefineValue>) => {
  if (Object.keys(directives).length === 0) {
    return [];
  }
  return Object.entries(directives).flatMap(([key, value]) =>
    value === null || value === undefined
      ? ['-s', key]
      : ['-s', `${key}=${String(value)}`]
  );
};

const buildExportFlags = (exports: readonly string[]) => {
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
  baseDir: string,
  extension: string
) => {
  if (targetOutFile) {
    return resolveOutFile(targetOutFile, env, baseDir);
  }
  return resolve(baseDir, `${targetName}.${extension}`);
};

const resolveTargetSources = async (
  targetSources: readonly string[] | undefined,
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

const dedupeValues = (values: readonly string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const resolvePackageJsonPath = async (
  startPath: string,
  packageName: string
) => {
  let current = dirname(startPath);
  for (;;) {
    const candidate = join(current, 'package.json');
    if (await pathExists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`package.json not found for import: ${packageName}`);
    }
    current = parent;
  }
};

const loadPackageJson = async (
  packageJsonPath: string,
  packageName: string
) => {
  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error('package.json must be an object.');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read package.json for import ${packageName}: ${message}`
    );
  }
};

const resolveImportPaths = async (
  resolver: NodeJS.Require,
  packageName: string
) => {
  let resolvedEntry: string;
  try {
    resolvedEntry = resolver.resolve(packageName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve import ${packageName}: ${message}`);
  }

  const packageJsonPath = await resolvePackageJsonPath(
    resolvedEntry,
    packageName
  );
  const packageRoot = dirname(packageJsonPath);
  const packageJson = await loadPackageJson(packageJsonPath, packageName);
  const emsdkConfigRaw = packageJson['emsdk-env'];
  if (emsdkConfigRaw !== undefined && !isRecord(emsdkConfigRaw)) {
    throw new Error(
      `Invalid emsdk-env config for import ${packageName}: expected an object.`
    );
  }

  const includeRaw = isRecord(emsdkConfigRaw)
    ? emsdkConfigRaw.include
    : undefined;
  if (includeRaw !== undefined && typeof includeRaw !== 'string') {
    throw new Error(
      `Invalid emsdk-env include for import ${packageName}: expected a string.`
    );
  }
  const libRaw = isRecord(emsdkConfigRaw) ? emsdkConfigRaw.lib : undefined;
  if (libRaw !== undefined && typeof libRaw !== 'string') {
    throw new Error(
      `Invalid emsdk-env lib for import ${packageName}: expected a string.`
    );
  }

  const includeRel = includeRaw ?? DEFAULT_IMPORT_INCLUDE_DIR;
  const libRel = libRaw ?? DEFAULT_IMPORT_LIB_DIR;
  const includeDir = resolve(packageRoot, includeRel);
  const libDir = resolve(packageRoot, libRel);
  const includeExists = await pathExists(includeDir);
  const libExists = await pathExists(libDir);
  if (!includeExists && !libExists) {
    throw new Error(
      `Import ${packageName} does not provide include or lib directories.`
    );
  }
  return {
    includeDir: includeExists ? includeDir : undefined,
    libDir: libExists ? libDir : undefined,
  };
};

const resolveImportDirectories = async (
  rootDir: string,
  imports: readonly string[]
) => {
  if (imports.length === 0) {
    return { includeDirs: [], libDirs: [] };
  }
  const moduleApi = await import('node:module');
  const resolver = moduleApi.createRequire(resolve(rootDir, 'package.json'));
  const includeDirs: string[] = [];
  const libDirs: string[] = [];
  for (const packageName of imports) {
    const resolved = await resolveImportPaths(resolver, packageName);
    if (resolved.includeDir) {
      includeDirs.push(resolved.includeDir);
    }
    if (resolved.libDir) {
      libDirs.push(resolved.libDir);
    }
  }
  return {
    includeDirs: dedupeValues(includeDirs),
    libDirs: dedupeValues(libDirs),
  };
};

type CompileArgs = {
  resolvedOptions: readonly string[];
  includeArgs: readonly string[];
  defineArgs: readonly string[];
};

const buildCompileArgs = (
  options: readonly string[],
  includeDirs: readonly string[],
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

/**
 * Build WASM binaries (and optional archives) from C/C++ sources using emsdk.
 *
 * Resolves the SDK via prepareEmsdk, expands build paths, compiles sources,
 * links targets, and returns output paths keyed by target name.
 *
 * @param options - Build options including rule definitions and shared settings.
 * @returns Build result with the resolved SDK root and output file paths.
 */
export const buildWasm = async (
  options: BuildWasmOptions
): Promise<BuildWasmResult> => {
  if (!options) {
    throw new TypeError('options must be provided.');
  }
  if (!options.rule || !options.rule.targets) {
    throw new TypeError('rule targets must be provided.');
  }
  const targetEntries = Object.entries(options.rule.targets);
  if (targetEntries.length === 0) {
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
  const rawIncludeDir = expandPlaceholders(
    options.includeDir ?? DEFAULT_WASM_INCLUDE_DIR,
    baseEnv,
    'includeDir'
  );
  const rawOutDir = expandPlaceholders(
    options.outDir ?? DEFAULT_WASM_OUT_DIR,
    baseEnv,
    'outDir'
  );
  const rawLibDir = expandPlaceholders(
    options.libDir ?? DEFAULT_WASM_LIB_DIR,
    baseEnv,
    'libDir'
  );
  const rawBuildDir = expandPlaceholders(
    options.buildDir ?? DEFAULT_WASM_BUILD_DIR,
    baseEnv,
    'buildDir'
  );

  const srcDir = resolvePath(rootDir, rawSrcDir);
  const includeDir = resolvePath(rootDir, rawIncludeDir);
  const outDir = resolvePath(rootDir, rawOutDir);
  const libDir = resolvePath(rootDir, rawLibDir);
  const buildDir = resolvePath(rootDir, rawBuildDir);
  const buildId = createBuildId();
  const buildRunDir = resolve(buildDir, buildId);
  const cleanupBuildDir = options.cleanupBuildDir ?? true;
  const parallel = options.parallel ?? true;

  const envWithDirs = {
    ...emsdkEnv,
    ROOT: rootDir,
    SRC_DIR: srcDir,
    INCLUDE_DIR: includeDir,
    OUT_DIR: outDir,
    LIB_DIR: libDir,
    BUILD_DIR: buildDir,
  };

  const emccCommand = await resolveEmccCommand(envWithDirs, emsdkRoot);
  const common = options.rule.common ?? {};
  const commonIncludeDirs =
    common.includeDirs === undefined ? [includeDir] : common.includeDirs;
  const importDirectories = await resolveImportDirectories(
    rootDir,
    ensureArray(options.imports)
  );
  const importIncludeDirs = importDirectories.includeDirs;
  const importLibDirs = importDirectories.libDirs;
  const linkLibDirs = dedupeValues([libDir, ...importLibDirs]);

  // Outputs path variables in debug
  logger.debug(`Detected rootDir: '${rootDir}'`);
  logger.debug(`Detected srcDir: '${srcDir}'`);
  logger.debug(`Detected outDir: '${outDir}'`);
  logger.debug(`Detected libDir: '${libDir}'`);
  logger.debug(`Detected buildDir: '${buildDir}'`);
  logger.debug(`Detected buildId: '${buildId}'`);
  logger.debug(`Detected buildRunDir: '${buildRunDir}'`);
  logger.debug(`Detected cleanupBuildDir: ${cleanupBuildDir}`);
  logger.debug(`Detected parallel: ${parallel}`);
  logger.debug(`Detected emccCommand: '${emccCommand}'`);
  logger.debug(
    `Detected importIncludeDirs: [${importIncludeDirs.map((p) => `'${p}'`).join(',')}]`
  );
  logger.debug(
    `Detected importLibDirs: [${importLibDirs.map((p) => `'${p}'`).join(',')}]`
  );

  await ensureDirectory(outDir);
  await ensureDirectory(libDir);
  await ensureDirectory(buildDir);
  await rm(buildRunDir, { recursive: true, force: true });
  await ensureDirectory(buildRunDir);

  const hasArchiveTargets = targetEntries.some(
    ([, target]) => resolveTargetType(target.type) === 'archive'
  );
  const emarCommand = hasArchiveTargets
    ? await resolveEmarCommand(envWithDirs, emsdkRoot)
    : undefined;
  if (emarCommand) {
    logger.debug(`Detected emarCommand: '${emarCommand}'`);
  }
  let wasmOptCommand: string | undefined;
  const getWasmOptCommand = async () => {
    if (wasmOptCommand) {
      return wasmOptCommand;
    }
    wasmOptCommand = await resolveWasmOptCommand(envWithDirs, emsdkRoot);
    logger.debug(`Detected wasmOptCommand: '${wasmOptCommand}'`);
    return wasmOptCommand;
  };

  const outFiles: Record<string, string> = {};

  const buildTargets = async (expectedType: WasmBuildTargetType) => {
    for (const [targetName, target] of targetEntries) {
      const targetType = resolveTargetType(target.type);
      if (targetType !== expectedType) {
        continue;
      }
      if (targetType === 'archive') {
        if (target.linkOptions !== undefined) {
          throw new Error(
            `linkOptions is not supported for archive target: ${targetName}`
          );
        }
        if (target.linkDirectives !== undefined) {
          throw new Error(
            `linkDirectives is not supported for archive target: ${targetName}`
          );
        }
        if (target.exports !== undefined) {
          throw new Error(
            `exports is not supported for archive target: ${targetName}`
          );
        }
        if (target.wasmOpt !== undefined) {
          throw new Error(
            `wasmOpt is not supported for archive target: ${targetName}`
          );
        }
      }

      const mergedLinkOptions =
        targetType === 'archive'
          ? []
          : [
              ...ensureArray(common.linkOptions),
              ...ensureArray(target.linkOptions),
            ];
      const mergedLinkDirectives =
        targetType === 'archive'
          ? {}
          : mergeLinkDirectives(common.linkDirectives, target.linkDirectives);
      const mergedExports =
        targetType === 'archive'
          ? []
          : [...ensureArray(common.exports), ...ensureArray(target.exports)];
      const wasmOptEnabled =
        targetType === 'archive'
          ? false
          : resolveWasmOptEnabled(common.wasmOpt, target.wasmOpt);
      const baseCompileOptions = [
        ...ensureArray(common.options),
        ...ensureArray(target.options),
      ];
      const baseIncludeDirs = [
        ...ensureArray(commonIncludeDirs),
        ...ensureArray(target.includeDirs),
        ...importIncludeDirs,
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
        targetType === 'archive' ? libDir : outDir,
        targetType === 'archive' ? 'a' : 'wasm'
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

      const resolvedLinkDirectives =
        targetType === 'archive'
          ? {}
          : resolveLinkDirectives(mergedLinkDirectives, targetEnv);
      const linkDirectiveArgs = buildLinkDirectiveFlags(resolvedLinkDirectives);
      const resolvedLinkOptions =
        targetType === 'archive'
          ? []
          : [
              ...linkDirectiveArgs,
              ...expandArray(mergedLinkOptions, targetEnv, 'linkOptions'),
            ];
      const resolvedExports =
        targetType === 'archive'
          ? []
          : expandArray(mergedExports, targetEnv, 'exports');
      const exportArgs = buildExportFlags(resolvedExports);
      const resolvedWasmOptArgs = wasmOptEnabled
        ? resolveWasmOptArgs(common.wasmOpt, target.wasmOpt, targetEnv)
        : [];
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
        const groupDefines = mergeDefines(baseDefines, group?.defines);
        return buildCompileArgs(
          groupOptions,
          groupIncludeDirs,
          groupDefines,
          targetEnv,
          rootDir
        );
      });

      //--------------------------------------------------------

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
        const sourcePath = relative(rootDir, source);
        logger.info(`Compiling source: ${sourcePath} --> $tmp/${objectName}.o`);
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

      // Aggregates base `sources` to the job list
      for (const source of baseSources) {
        compileJobs.push({
          source,
          args: baseCompileArgs,
          groupIndex: undefined,
        });
      }

      // Aggregates grouped `sources` to the job list
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

      // Final job stats to logger
      logger.info(
        parallel
          ? `Building target: '${targetName}' [${compileJobs.length} files, in parallel]`
          : `Building target: '${targetName}' [${compileJobs.length} files]`
      );

      // Execute the job
      const objectFiles = parallel
        ? await Promise.all(
            compileJobs.map((job) =>
              compileSource(job.source, job.args, job.groupIndex)
            )
          )
        : await buildObjectsSequential();

      //--------------------------------------------------------

      if (targetType === 'archive') {
        // Execute emsdk archiver
        if (!emarCommand) {
          throw new Error('emar command is required for archive targets.');
        }
        logger.info(`Archiving target: ${targetName}.a`);
        const archiveArgs = ['rcs', resolvedOutFile, ...objectFiles];
        logger.debug(`emar ${archiveArgs.join(' ')}`);
        await runCommandWithEnv(
          emarCommand,
          archiveArgs,
          rootDir,
          buildEnv,
          emsdkOptions.signal
        );
      } else {
        // Execute emsdk linker
        logger.info(`Linking target: ${targetName}.wasm`);
        const linkArgs = [
          ...objectFiles,
          '-o',
          resolvedOutFile,
          ...linkLibDirs.map((dir) => `-L${dir}`),
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
        if (wasmOptEnabled) {
          const wasmOptInput = resolveWasmOptInputFile(
            resolvedOutFile,
            resolvedLinkOptions
          );
          if (!(await pathExists(wasmOptInput))) {
            throw new Error(
              `wasm-opt enabled but wasm binary not found: ${wasmOptInput}`
            );
          }
          const tempOutFile = `${wasmOptInput}.opt`;
          const wasmOptArgs = [
            wasmOptInput,
            '-o',
            tempOutFile,
            ...resolvedWasmOptArgs,
          ];
          const wasmOptCommand = await getWasmOptCommand();
          logger.info(`Optimizing target: ${targetName}.wasm`);
          logger.debug(`wasm-opt ${wasmOptArgs.join(' ')}`);
          await runCommandWithEnv(
            wasmOptCommand,
            wasmOptArgs,
            rootDir,
            buildEnv,
            emsdkOptions.signal
          );
          await rm(wasmOptInput, { force: true });
          await rename(tempOutFile, wasmOptInput);
        }
      }

      outFiles[targetName] = resolvedOutFile;
    }
  };

  try {
    await buildTargets('archive');
    await buildTargets('wasm');
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
