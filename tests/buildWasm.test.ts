// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { describe, expect, test } from 'vitest';

import { buildWasm } from '../src/index';

type MockRepo = {
  repoUrl: string;
  cleanup: () => Promise<void>;
};

const createMockRepo = async (): Promise<MockRepo> => {
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
set -euo pipefail

log="\${EMCC_LOG:-}"
if [ -n "\${log}" ]; then
  {
    echo "CALL"
    for arg in "\$@"; do
      printf 'ARG=%s\\n' "\${arg}"
    done
    echo "END"
  } >> "\${log}"
fi

out=""
prev=""
for arg in "\$@"; do
  if [ "\${prev}" = "1" ]; then
    out="\${arg}"
    prev=""
    continue
  fi
  if [ "\${arg}" = "-o" ]; then
    prev="1"
  fi
done

if [ -z "\${out}" ]; then
  exit 2
fi

mkdir -p "\$(dirname "\${out}")"
echo "mock" > "\${out}"
EMCC
    chmod +x "upstream/emscripten/emcc"
    ;;
  activate)
    if [ -z "\${target}" ]; then
      echo "activate requires a target version" >&2
      exit 2
    fi
    cat > "emsdk_env.sh" <<'ENV'
export EMSCRIPTEN="\${PWD}/upstream/emscripten"
export PATH="\${PWD}/upstream/emscripten:\${PATH}"
export EMCC_LOG="\${PWD}/.emcc-log"
ENV
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
    repoUrl: pathToFileURL(repoDir).toString(),
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
};

const parseEmccLog = (logText: string) => {
  const calls: string[][] = [];
  let current: string[] = [];
  const lines = logText.split('\n');
  for (const line of lines) {
    if (line === 'CALL') {
      current = [];
      continue;
    }
    if (line === 'END') {
      calls.push(current);
      current = [];
      continue;
    }
    if (line.startsWith('ARG=')) {
      current.push(line.slice('ARG='.length));
    }
  }
  return calls;
};

describe('buildWasm', () => {
  test('builds targets with merged options and default sources', async () => {
    const mockRepo = await createMockRepo();
    const cacheDir = await mkdtemp(join(tmpdir(), 'emsdk-env-cache-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'emsdk-env-project-'));
    const wasmDir = join(projectRoot, 'wasm');
    const includeDir = join(projectRoot, 'include');

    await mkdir(wasmDir, { recursive: true });
    await mkdir(includeDir, { recursive: true });
    await writeFile(join(wasmDir, 'alpha.c'), 'int alpha() { return 1; }');
    await writeFile(join(wasmDir, 'beta.cpp'), 'int beta() { return 2; }');

    try {
      const result = await buildWasm({
        emsdk: {
          targetVersion: 'test-version',
          cacheDir,
          repoUrl: mockRepo.repoUrl,
        },
        root: projectRoot,
        rule: {
          common: {
            options: ['-g'],
            defines: {
              _DEBUG: true,
              SIMD_ENABLED: '0',
            },
            exports: ['_common'],
          },
          targets: {
            target1: {
              outFile: '{OUT_DIR}/custom.wasm',
              sources: ['{SRC_DIR}/alpha.c'],
              options: ['-O3'],
              linkOptions: ['-s', 'ALLOW_MEMORY_GROWTH=1'],
              exports: ['_target1'],
              includeDirs: ['include'],
              defines: {
                SIMD_ENABLED: '1',
              },
            },
            target2: {
              linkOptions: ['-s', 'ALLOW_MEMORY_GROWTH=1'],
            },
          },
        },
      });

      const target1Out = result.outFiles.target1;
      const target2Out = result.outFiles.target2;
      if (!target1Out || !target2Out) {
        throw new Error('Missing output file paths.');
      }
      expect(target1Out).toBe(resolve(projectRoot, 'src/wasm/custom.wasm'));
      expect(target2Out).toBe(resolve(projectRoot, 'src/wasm/target2.wasm'));
      expect(existsSync(target1Out)).toBe(true);
      expect(existsSync(target2Out)).toBe(true);

      const target1Objects = await readdir(
        resolve(projectRoot, '.wasm-build', 'target1')
      );
      const target2Objects = await readdir(
        resolve(projectRoot, '.wasm-build', 'target2')
      );
      expect(target1Objects.filter((name) => name.endsWith('.o')).length).toBe(
        1
      );
      expect(target2Objects.filter((name) => name.endsWith('.o')).length).toBe(
        2
      );

      const emccLogPath = resolve(result.emsdkRoot, '.emcc-log');
      expect(existsSync(emccLogPath)).toBe(true);
      const emccLogText = await readFile(emccLogPath, 'utf8');
      const calls = parseEmccLog(emccLogText);
      const target1Compile = calls.find(
        (args) =>
          args.includes('-c') &&
          args.some((arg) => arg.includes(`${join('.wasm-build', 'target1')}`))
      );
      expect(target1Compile).toBeTruthy();
      if (!target1Compile) {
        throw new Error('Missing compile call for target1.');
      }
      expect(target1Compile).toContain('-DSIMD_ENABLED=1');
      expect(target1Compile).toContain('-D_DEBUG=true');
      expect(target1Compile).not.toContain('-DSIMD_ENABLED=0');

      const target2CompileCalls = calls.filter(
        (args) =>
          args.includes('-c') &&
          args.some((arg) => arg.includes(`${join('.wasm-build', 'target2')}`))
      );
      expect(target2CompileCalls.length).toBe(2);
      for (const call of target2CompileCalls) {
        expect(call).toContain('-DSIMD_ENABLED=0');
      }

      const target1Link = calls.find(
        (args) => args.includes(target1Out) && !args.includes('-c')
      );
      expect(target1Link).toBeTruthy();
      if (!target1Link) {
        throw new Error('Missing link call for target1.');
      }
      expect(target1Link).toContain(
        'EXPORTED_FUNCTIONS=["_common","_target1"]'
      );

      const target2Link = calls.find(
        (args) => args.includes(target2Out) && !args.includes('-c')
      );
      expect(target2Link).toBeTruthy();
      if (!target2Link) {
        throw new Error('Missing link call for target2.');
      }
      expect(target2Link).toContain('EXPORTED_FUNCTIONS=["_common"]');
    } finally {
      await mockRepo.cleanup();
      await rm(cacheDir, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
