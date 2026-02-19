# emsdk-env

A Vite plugin that automatically builds WASM C/C++ source code using the Emscripten SDK.

![emsdk-env](./images/emsdk-env-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

WIP:

## What is this?

This is a Vite plugin that automatically downloads and manages the Emscripten SDK, and makes it possible to automatically build WASM C/C++ code in your project.
With this plugin, you can easily set up a WASM C/C++ development environment in your Vite project.

Usage is simple. Just add this Vite plugin package to your project and initialize the plugin in `vite.config.ts` like this:

```typescript
// `vite.config.ts`
import { defineConfig } from 'vite';

// Refer to the emsdk-env Vite plugin
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    // Add as a plugin
    emsdkEnv({
      // Build targets
      targets: {
        // Generate "add.wasm"
        add: {
          // Compiler options
          options: ['-O3', '-std=c99'],
          // Linker options
          linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
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

### Documents

For more information, please visit repository and refer README: [emsdk-env](https://github.com/kekyo/emsdk-env)

---

## License

Under MIT.
