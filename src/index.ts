// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { spawn } from 'child_process';
import { constants, access, mkdtemp, mkdir, rename, rm } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createMutex } from 'async-primitives';
import { simpleGit, type SimpleGitOptions } from 'simple-git';

const DEFAULT_REPO_URL = 'https://github.com/emscripten-core/emsdk.git';
const DEFAULT_GIT_REF = 'main';
const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'emsdk-env');

export type PrepareEmsdkOptions = {
  targetVersion: string;
  cacheDir?: string;
  repoUrl?: string;
  gitPath?: string;
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
