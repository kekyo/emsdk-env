// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { readdir, readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '..');

const findBuildOutputs = async () => {
  const distDir = resolve(workspaceRoot, 'dist');
  const entries = await readdir(distDir);
  return entries
    .filter((entry) => entry.startsWith('build-') && entry.endsWith('.js'))
    .map((entry) => resolve(distDir, entry));
};

describe('build output', () => {
  test('keeps node:module externalized', async () => {
    const buildFiles = await findBuildOutputs();
    expect(buildFiles.length).toBeGreaterThan(0);

    for (const buildFile of buildFiles) {
      const content = await readFile(buildFile, 'utf8');
      const imports = [...content.matchAll(/await\s*import\(([^)]+)\)/g)].map(
        (match) => match[1] ?? ''
      );
      const moduleImport = imports.find((specifier) =>
        specifier.includes('node:module')
      );
      if (!moduleImport) {
        throw new Error(`node:module import not found in ${buildFile}.`);
      }
      expect(moduleImport).not.toContain('__vite-browser-external');
    }
  });
});
