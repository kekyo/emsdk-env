// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { isAbsolute, relative, resolve } from 'path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

import type { EmsdkVitePluginOptions } from './types';
import { createViteLoggerAdapter } from './logger';
import { buildWasm } from '../index';

/////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_WASM_SRC_DIR = 'wasm';
const buildRuns = new Map<string, Promise<void>>();

/////////////////////////////////////////////////////////////////////////////////////////////////

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

const resolveIncludeDirs = (
  includeDirs: readonly string[],
  env: Record<string, string>,
  rootDir: string
) => {
  const expanded = expandArray(includeDirs, env, 'includeDirs');
  return expanded.map((value) => resolvePath(rootDir, value));
};

const createBuildOptions = (
  options: EmsdkVitePluginOptions,
  resolvedConfig: ResolvedConfig,
  logger: ReturnType<typeof createViteLoggerAdapter>
) => {
  const {
    emsdk,
    srcDir,
    imports,
    outDir,
    libDir,
    buildDir,
    cleanupBuildDir,
    ...rule
  } = options;
  return {
    rule,
    root: resolvedConfig.root,
    logger,
    ...(emsdk !== undefined ? { emsdk } : {}),
    ...(srcDir !== undefined ? { srcDir } : {}),
    ...(imports !== undefined ? { imports } : {}),
    ...(outDir !== undefined ? { outDir } : {}),
    ...(libDir !== undefined ? { libDir } : {}),
    ...(buildDir !== undefined ? { buildDir } : {}),
    ...(cleanupBuildDir !== undefined ? { cleanupBuildDir } : {}),
  };
};

const isSubPath = (parentDir: string, targetPath: string) => {
  const rel = relative(parentDir, targetPath);
  if (rel === '') {
    return true;
  }
  return !rel.startsWith('..') && !isAbsolute(rel);
};

const resolveWatchTargets = (
  options: EmsdkVitePluginOptions,
  resolvedConfig: ResolvedConfig
) => {
  const rootDir = resolvedConfig.root;
  const baseEnv = {
    ROOT: rootDir,
  };
  const rawSrcDir = expandPlaceholders(
    options.srcDir ?? DEFAULT_WASM_SRC_DIR,
    baseEnv,
    'srcDir'
  );
  const srcDir = resolvePath(rootDir, rawSrcDir);

  const envWithDirs = {
    ROOT: rootDir,
    SRC_DIR: srcDir,
  };

  const patterns = new Set<string>();
  const baseDirs = new Set<string>();
  const resolvedIncludeDirs: string[] = [];
  patterns.add(srcDir);
  baseDirs.add(srcDir);

  const addIncludePatterns = (
    targetIncludeDirs: readonly string[] | undefined,
    targetName: string | undefined
  ) => {
    if (!targetIncludeDirs || targetIncludeDirs.length === 0) {
      return;
    }
    const env = targetName
      ? { ...envWithDirs, TARGET_NAME: targetName }
      : envWithDirs;
    const resolvedDirs = resolveIncludeDirs(targetIncludeDirs, env, rootDir);
    for (const dir of resolvedDirs) {
      patterns.add(dir);
      baseDirs.add(dir);
      resolvedIncludeDirs.push(dir);
    }
  };

  addIncludePatterns(options.common?.includeDirs, undefined);
  for (const [targetName, target] of Object.entries(options.targets)) {
    addIncludePatterns(target.includeDirs, targetName);
  }

  return {
    srcDir,
    includeDirs: resolvedIncludeDirs,
    patterns: [...patterns],
    baseDirs: [...baseDirs],
  };
};

const setupDevServer = async (
  server: ViteDevServer,
  options: EmsdkVitePluginOptions,
  resolvedConfig: ResolvedConfig
) => {
  const logger = createViteLoggerAdapter(
    resolvedConfig.logger,
    resolvedConfig.logLevel ?? 'info',
    'emsdk-env'
  );
  const buildOptions = createBuildOptions(options, resolvedConfig, logger);

  const watchTargets = resolveWatchTargets(options, resolvedConfig);
  logger.debug(`watch root: ${resolvedConfig.root}`);
  logger.debug(`watch srcDir: ${watchTargets.srcDir}`);
  logger.debug(
    `watch includeDirs: ${
      watchTargets.includeDirs.length > 0
        ? watchTargets.includeDirs.join(', ')
        : '(none)'
    }`
  );
  logger.debug(`watch patterns: ${watchTargets.patterns.join(', ')}`);
  logger.debug(`watch baseDirs: ${watchTargets.baseDirs.join(', ')}`);
  if (watchTargets.patterns.length > 0) {
    server.watcher.add(watchTargets.patterns);
  }

  let buildQueue = Promise.resolve();
  const queueBuild = async (shouldReload: boolean) => {
    buildQueue = buildQueue.then(async () => {
      try {
        await buildWasm(buildOptions);
        if (shouldReload) {
          server.ws.send({ type: 'full-reload' });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown wasm build error.';
        logger.error(`Wasm build failed: ${message}`);
      }
    });
    return buildQueue;
  };

  const onWatchEvent = async (eventPath: string) => {
    const resolvedPath = isAbsolute(eventPath)
      ? eventPath
      : resolve(resolvedConfig.root, eventPath);
    if (!watchTargets.baseDirs.some((dir) => isSubPath(dir, resolvedPath))) {
      return;
    }
    await queueBuild(true);
  };

  server.watcher.on('add', onWatchEvent);
  server.watcher.on('change', onWatchEvent);
  server.watcher.on('unlink', onWatchEvent);

  await queueBuild(false);
};

/////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Vite plugin that builds C/C++ sources into WASM using the Emscripten SDK.
 *
 * In dev (`vite serve`), it watches source/include directories and rebuilds on
 * changes. In build (`vite build`), it performs a one-shot build before bundling.
 *
 * @param options - Plugin options including build rules.
 * @returns Vite plugin instance.
 */
const emsdkEnv = (options: EmsdkVitePluginOptions): Plugin => {
  let resolvedConfig: ResolvedConfig | undefined;
  return {
    name: 'emsdkEnv',
    enforce: 'pre',
    configResolved(config) {
      resolvedConfig = config;
    },
    async buildStart() {
      if (!resolvedConfig) {
        throw new Error('Vite config was not resolved.');
      }
      if (resolvedConfig.command !== 'build') {
        return;
      }
      const logger = createViteLoggerAdapter(
        resolvedConfig.logger,
        resolvedConfig.logLevel ?? 'info',
        'emsdk-env'
      );
      const buildOptions = createBuildOptions(options, resolvedConfig, logger);
      const buildKey = resolvedConfig.root;
      const existing = buildRuns.get(buildKey);
      if (existing) {
        await existing;
        return;
      }
      const run = (async () => {
        try {
          await buildWasm(buildOptions);
        } finally {
          buildRuns.delete(buildKey);
        }
      })();
      buildRuns.set(buildKey, run);
      await run;
    },
    async configureServer(server) {
      if (!resolvedConfig) {
        throw new Error('Vite config was not resolved.');
      }
      if (resolvedConfig.command !== 'serve') {
        return;
      }
      await setupDevServer(server, options, resolvedConfig);
    },
  };
};

export default emsdkEnv;
