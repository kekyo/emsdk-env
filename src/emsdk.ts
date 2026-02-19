// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { mkdtemp, rename, rm } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createMutex } from 'async-primitives';

import { runCommand } from './commands';
import { ensureDirectory, pathExists } from './fs-utils';
import type { PrepareEmsdkOptions } from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_REPO_URL = 'https://github.com/emscripten-core/emsdk.git';
const DEFAULT_GIT_REF = 'main';
const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'emsdk-env');
const DEFAULT_TARGET_VERSION = 'latest';

const versionMutexes = new Map<string, ReturnType<typeof createMutex>>();

/////////////////////////////////////////////////////////////////////////////////////////////////

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

const resolveEmsdkCommand = () =>
  process.platform === 'win32' ? 'emsdk.bat' : './emsdk';

const runEmsdk = async (
  repoDir: string,
  args: string[],
  signal: AbortSignal | undefined
) => {
  if (process.platform === 'win32') {
    await runCommand('cmd', ['/c', 'emsdk.bat', ...args], repoDir, signal);
    return;
  }
  await runCommand(resolveEmsdkCommand(), args, repoDir, signal);
};

const runGitClone = async (
  gitPath: string,
  repoUrl: string,
  targetDir: string,
  cwd: string,
  signal: AbortSignal | undefined
) => {
  await runCommand(
    gitPath,
    ['clone', repoUrl, targetDir, '--depth', '1', '--branch', DEFAULT_GIT_REF],
    cwd,
    signal
  );
};

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code !== undefined &&
  ['EEXIST', 'ENOTEMPTY', 'EISDIR'].includes(
    String((error as NodeJS.ErrnoException).code)
  );

/////////////////////////////////////////////////////////////////////////////////////////////////

export const prepareEmsdk = async (
  options: PrepareEmsdkOptions
): Promise<string> => {
  if (!options) {
    throw new TypeError('options must be provided.');
  }
  if (
    options.targetVersion !== undefined &&
    typeof options.targetVersion !== 'string'
  ) {
    throw new TypeError('targetVersion must be a string.');
  }
  const targetVersion = options.targetVersion ?? DEFAULT_TARGET_VERSION;
  ensureNonEmpty(targetVersion, 'targetVersion');
  options.signal?.throwIfAborted();

  const cacheDir = resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
  const repoUrl = options.repoUrl ?? DEFAULT_REPO_URL;
  const gitPath = options.gitPath ?? 'git';

  const versionDir = sanitizeSegment(targetVersion);
  const finalDir = resolve(cacheDir, versionDir);

  const mutex = getVersionMutex(finalDir);
  const lock = await mutex.lock(options.signal);
  try {
    options.signal?.throwIfAborted();
    if (await pathExists(finalDir)) {
      return finalDir;
    }

    await ensureDirectory(cacheDir);

    const tempRoot = await mkdtemp(join(cacheDir, '.tmp-'));
    const tempRepoDir = join(tempRoot, 'emsdk');

    try {
      await runGitClone(
        gitPath,
        repoUrl,
        tempRepoDir,
        cacheDir,
        options.signal
      );
      options.signal?.throwIfAborted();
      await runEmsdk(tempRepoDir, ['install', targetVersion], options.signal);

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

    options.signal?.throwIfAborted();
    await runEmsdk(finalDir, ['activate', targetVersion], options.signal);
    return finalDir;
  } finally {
    lock.release();
  }
};
