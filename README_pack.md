# emsdk-env

A Vite plugin that automatically builds WASM C/C++ source code using the Emscripten SDK.

![emsdk-env](./images/emsdk-env-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is this?

This is a Vite plugin that automatically downloads and manages the [Emscripten SDK](https://github.com/emscripten-core/emsdk),
and makes it possible to automatically build WASM C/C++ code in your project.
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
      // Generate a runtime loader code
      generatedLoader: { enable: true },
      // Build targets
      targets: {
        // Generate "add.wasm"
        add: {
          // Compiler options
          options: ['-O3', '-std=c99'],
          // Linker options
          linkOptions: ['--no-entry'],
          // Linker directives
          linkDirectives: { STANDALONE_WASM: 1 },
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
- Archive libraries (`*.a`) can be built and referenced
- WASM libraries can be distributed and referenced via NPM packages

---

## Usage

### Installation

Add to `devDependencies` (emsdk-env itself does not require runtime code):

```bash
$ npm install -D emsdk-env
```

- emsdk-env automatically downloads and caches the Emscripten SDK (located under `~/.cache/emsdk-env/`).
  Therefore, you do not need to manually set up the Emscripten SDK.

### C/C++ Source Code and Binary Placement

By default, C/C++ source code is placed in the `wasm/` directory under your project,
and the built WASM binaries are placed in the `src/wasm/` directory.

A typical directory structure looks like this:

```
project/
├── package.json
├── vite.config.ts
├── src/
│   ├── generated/
│   │   └── wasm-loader.ts   // (Generate automatically)
│   └── wasm/
│       └── add.wasm         // (Built WASM binary)
└── wasm/
    └── add.c
```

- `wasm-loader.ts` is helper code that loads and makes WASM binaries usable.
- In addition to the above, a temporary build directory is created under the OS temp directory.
  The default location is `${TMPDIR}/emsdk-env` (typically `/tmp/emsdk-env` on Unix).
  This directory is used during the build process and is typically deleted after the build completes.
  If you override `buildDir` to point inside the project, add it to `.gitignore`.

Of course, you can change these. Specify them in the Vite plugin options.

You might find it odd that the built binary is placed in `src/wasm/`,
but this is because the Vite server defaults to a path where it can easily access WASM binaries.

If `generatedLoader.enable` is set to `true`, emsdk-env also generates a WASM loader helper code by default at `src/generated/wasm-loader.ts`.
That loader can call the final WASM exports directly:

```typescript
import { loadAddWasm } from './generated/wasm-loader';

// WASM exported function declaration (You need to define it)
interface AddExports {
  add?: (a: number, b: number) => number;
}

// Load WASM binary and instantiates it
const wasm = await loadAddWasm<AddExports>();

// Get `add()` function entry point
const add = wasm.exports.add;
if (typeof add !== 'function') {
  throw new Error('add function not found in wasm exports.');
}

// Then use it now
const result = add(1, 2);
```

- You need to define WASM export functions yourself.
  When doing so, the symbol name for the exported function is the same as the C/C++ function name in TypeScript,
  but the symbol name specified in `exports: [...]` typically requires an underscore prefix (`add()` --> `_add`).

If you plan to operate with the default settings, there is essentially no configuration work required.

Other topics include features such as explicitly specifying source files, applying multiple compile options separately, handling multiple target outputs, generating and referencing archive library files, and compilation and referencing NPM packages.

### Documents

For more information, please visit repository and refer README: [emsdk-env](https://github.com/kekyo/emsdk-env)

---

## License

Under MIT.
