# emsdk-env

A Vite plugin that automatically builds WASM C/C++ source code using the Emscripten SDK.

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/emsdk-env.svg)](https://www.npmjs.com/package/emsdk-env)

---

[(Japanese language is here/日本語はこちら)](./README_ja.md)

WIP:

## What is this?

This is a Vite plugin that automatically downloads and manages the Emscripten SDK, and makes it possible to automatically build WASM C/C++ code in your project.
With this plugin, you can easily set up a WASM C/C++ development environment in your Vite project.

Usage is simple. Just add this Vite plugin package to your project and initialize the plugin in `vite.config` like this:

```typescript
// `vite.config.ts`
import { defineConfig } from 'vite';

// Refer to the emsdk-env Vite plugin
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    // Add as a plugin
    emsdkEnv({
      // Common build options
      common: {
        options: ['-O3', '-std=c99'],
        linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
      },
      // Build targets
      targets: {
        // Generate "add.wasm"
        add: {
          // Exported symbols
          exports: ['_add'],
        },
      },
    }),
  ],
});
```

If the source code changes, it will automatically rebuild and reload the page.
You can focus on writing C/C++ code just like you would TypeScript/JavaScript code!

### Features

- Automatic setup and caching of the Emscripten SDK
- HMR support via Vite plugin (Note: C/C++ code requires a full build)
- Support for parallel builds
- Simplified specification of export symbols
- Ability to generate multiple target WASM binaries
- Customizable directory paths, compile options, and linker options

---

## Usage

### Installation

Add to `devDependencies` (emsdk-env itself does not require runtime code):

```bash
$ npm install -D emsdk-env
```

### C/C++ Source Code and Binary Placement

By default, C/C++ source code is placed in the `wasm/` directory under your project,
and the built WASM binaries are placed in the `src/wasm/` directory.

A typical directory structure looks like this:

```
project/
├── package.json
├── vite.config.ts
├── src/
│   └── wasm/
│       └── add.wasm
└── wasm/
    └── add.c
```

- In addition to the above, a temporary build directory is created under the OS temp directory.
  The default location is `${TMPDIR}/emsdk-env` (typically `/tmp/emsdk-env` on Unix).
  This directory is used during the build process and is typically deleted after the build completes.
  If you override `buildDir` to point inside the project, add it to `.gitignore`.

Of course, you can change these. Specify them in the Vite plugin options.

TODO:

---

## License

Under MIT.
