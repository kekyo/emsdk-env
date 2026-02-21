// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { join, resolve } from 'path';

import { runCommandCapture } from './commands';
import { pathExists } from './fs-utils';
import type { Logger } from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

const shellQuote = (value: string) =>
  `'${String(value).replace(/'/g, `'\"'\"'`)}'`;

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

/////////////////////////////////////////////////////////////////////////////////////////////////

export const loadEmsdkEnv = async (
  emsdkRoot: string,
  logger: Logger,
  signal: AbortSignal | undefined
) => {
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
  const output = await runCommandCapture(
    'bash',
    ['-lc', command],
    emsdkRoot,
    signal
  );
  return parseEnvBuffer(output);
};

export const resolveEmccCommand = async (
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

export const resolveEmarCommand = async (
  env: Record<string, string>,
  emsdkRoot: string
) => {
  if (env.EMAR) {
    return env.EMAR;
  }
  if (env.EMSCRIPTEN) {
    const candidate = join(env.EMSCRIPTEN, 'emar');
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  const fallback = join(emsdkRoot, 'upstream', 'emscripten', 'emar');
  if (await pathExists(fallback)) {
    return fallback;
  }
  return 'emar';
};

export const resolveWasmOptCommand = async (
  env: Record<string, string>,
  emsdkRoot: string
) => {
  if (env.WASM_OPT) {
    return env.WASM_OPT;
  }
  const binaryenRoot = env.BINARYEN_ROOT ?? env.BINARYEN;
  if (binaryenRoot) {
    const candidate = join(binaryenRoot, 'bin', 'wasm-opt');
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  const fallback = join(emsdkRoot, 'upstream', 'bin', 'wasm-opt');
  if (await pathExists(fallback)) {
    return fallback;
  }
  return 'wasm-opt';
};
