// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, test } from 'vitest';

import { prepareEmsdk } from '../src/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '..', '..');

const createMockRepo = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-mock-'));
  const repoDir = join(tempRoot, 'emsdk');

  execFileSync('git', ['init', '-b', 'main', repoDir], {
    stdio: 'inherit',
  });
  execFileSync(
    'git',
    ['-C', repoDir, 'config', 'user.email', 'emsdk-env-test@example.local'],
    {
      stdio: 'inherit',
    }
  );
  execFileSync(
    'git',
    ['-C', repoDir, 'config', 'user.name', 'emsdk-env-test'],
    {
      stdio: 'inherit',
    }
  );

  const emsdkScript = `#!/usr/bin/env bash

set -euo pipefail

command="\${1:-}"
target="\${2:-}"

case "\${command}" in
  install)
    if [ -z "\${target}" ]; then
      echo "install requires a target version" >&2
      exit 2
    fi
    mkdir -p "upstream/emscripten"
    cat > "upstream/emscripten/emcc" <<'EMCC'
#!/usr/bin/env bash
echo "mock emcc"
EMCC
    chmod +x "upstream/emscripten/emcc"
    printf '%s\n' "\${PWD}" > ".install-path"
    printf '%s\n' "\${target}" > ".install-version"
    ;;
  activate)
    if [ -z "\${target}" ]; then
      echo "activate requires a target version" >&2
      exit 2
    fi
    printf '%s\n' "\${PWD}" > ".activate-start"
    if [ -n "\${EMSDK_ENV_TEST_DELAY:-}" ]; then
      sleep "\${EMSDK_ENV_TEST_DELAY}"
    fi
    printf '%s\n' "\${PWD}" > ".activate-path"
    printf '%s\n' "\${target}" > ".activate-version"
    echo "EMSCRIPTEN_ROOT='\${PWD}/upstream/emscripten'" > ".emscripten"
    if [ -f ".activate-count" ]; then
      count="\$(cat .activate-count)"
    else
      count="0"
    fi
    count="$((count + 1))"
    printf '%s\n' "\${count}" > ".activate-count"
    cat > "emsdk_env.sh" <<'ENV'
export EMSDK_ENV_MOCK=1
ENV
    printf '%s\n' "\${PWD}" > ".activate-end"
    ;;
  *)
    echo "unknown command: \${command}" >&2
    exit 2
    ;;
esac
`;

  const emsdkPath = join(repoDir, 'emsdk');
  await writeFile(emsdkPath, emsdkScript);
  await chmod(emsdkPath, 0o755);

  execFileSync('git', ['-C', repoDir, 'add', 'emsdk'], {
    stdio: 'inherit',
  });
  execFileSync(
    'git',
    ['-C', repoDir, 'commit', '-m', 'Add mock emsdk script'],
    {
      stdio: 'inherit',
    }
  );

  return {
    repoDir,
    repoUrl: pathToFileURL(repoDir).toString(),
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
};

const readRequiredFile = async (targetPath: string) => {
  if (!existsSync(targetPath)) {
    throw new Error(`Expected file to exist: ${targetPath}`);
  }
  return (await readFile(targetPath, 'utf8')).trim();
};

describe.sequential('prepareEmsdk', () => {
  test('clones, installs, activates, and returns final path', async () => {
    const mockRepo = await createMockRepo();
    const cacheDir = await mkdtemp(join(workspaceRoot, '.test-cache-'));
    try {
      const targetVersion = 'test-version';
      const result = await prepareEmsdk({
        targetVersion,
        cacheDir,
        repoUrl: mockRepo.repoUrl,
      });

      const expectedDir = resolve(cacheDir, targetVersion);
      expect(result).toBe(expectedDir);
      expect(existsSync(expectedDir)).toBe(true);

      const installPath = await readRequiredFile(
        join(expectedDir, '.install-path')
      );
      const activatePath = await readRequiredFile(
        join(expectedDir, '.activate-path')
      );
      const installVersion = await readRequiredFile(
        join(expectedDir, '.install-version')
      );
      const activateVersion = await readRequiredFile(
        join(expectedDir, '.activate-version')
      );

      expect(installPath).not.toBe(expectedDir);
      expect(activatePath).toBe(expectedDir);
      expect(installVersion).toBe(targetVersion);
      expect(activateVersion).toBe(targetVersion);
      expect(existsSync(join(expectedDir, '.emscripten'))).toBe(true);
      expect(
        existsSync(join(expectedDir, 'upstream', 'emscripten', 'emcc'))
      ).toBe(true);
    } finally {
      await mockRepo.cleanup();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test('returns existing path without rerunning activate', async () => {
    const mockRepo = await createMockRepo();
    const cacheDir = await mkdtemp(join(workspaceRoot, '.test-cache-'));
    try {
      const targetVersion = 'repeat-version';
      const first = await prepareEmsdk({
        targetVersion,
        cacheDir,
        repoUrl: mockRepo.repoUrl,
      });
      const countPath = join(first, '.activate-count');
      const countBefore = Number(await readRequiredFile(countPath));

      const second = await prepareEmsdk({
        targetVersion,
        cacheDir,
        repoUrl: mockRepo.repoUrl,
      });
      const countAfter = Number(await readRequiredFile(countPath));

      expect(second).toBe(first);
      expect(countAfter).toBe(countBefore);
    } finally {
      await mockRepo.cleanup();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  test('waits for activation when called concurrently', async () => {
    const mockRepo = await createMockRepo();
    const cacheDir = await mkdtemp(join(workspaceRoot, '.test-cache-'));
    const originalDelay = process.env.EMSDK_ENV_TEST_DELAY;
    let firstPromise: Promise<string> | undefined;
    let secondPromise: Promise<string> | undefined;
    try {
      process.env.EMSDK_ENV_TEST_DELAY = '0.5';
      const targetVersion = 'concurrent-version';

      firstPromise = prepareEmsdk({
        targetVersion,
        cacheDir,
        repoUrl: mockRepo.repoUrl,
      });
      secondPromise = prepareEmsdk({
        targetVersion,
        cacheDir,
        repoUrl: mockRepo.repoUrl,
      });

      const secondResult = await secondPromise;
      const activateEndPath = join(secondResult, '.activate-end');
      expect(existsSync(activateEndPath)).toBe(true);
    } finally {
      const pending: Promise<string>[] = [];
      if (firstPromise) {
        pending.push(firstPromise);
      }
      if (secondPromise) {
        pending.push(secondPromise);
      }
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      }
      if (originalDelay === undefined) {
        delete process.env.EMSDK_ENV_TEST_DELAY;
      } else {
        process.env.EMSDK_ENV_TEST_DELAY = originalDelay;
      }
      await mockRepo.cleanup();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
