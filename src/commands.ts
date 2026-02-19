// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { spawn } from 'child_process';

/////////////////////////////////////////////////////////////////////////////////////////////////

const createAbortError = () => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

export const runCommand = async (
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined
) => {
  signal?.throwIfAborted();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      rejectPromise(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
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
};

export const runCommandWithEnv = async (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined
) => {
  signal?.throwIfAborted();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    });
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      rejectPromise(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
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
};

export const runCommandCapture = async (
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined
) => {
  signal?.throwIfAborted();
  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      rejectPromise(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    });
    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
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
};
