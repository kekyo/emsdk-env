// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { constants, access, mkdir } from 'fs/promises';

/////////////////////////////////////////////////////////////////////////////////////////////////

export const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const ensureDirectory = async (targetPath: string) => {
  await mkdir(targetPath, { recursive: true });
};
