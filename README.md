# emsdk-env

A Vite plugin that automatically builds WASM C/C++ source code using the Emscripten SDK.

![emsdk-env](./images/emsdk-env-120.png)

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

- In addition to the above, a temporary build directory is created under the OS temp directory.
  The default location is `${TMPDIR}/emsdk-env` (typically `/tmp/emsdk-env` on Unix).
  This directory is used during the build process and is typically deleted after the build completes.
  If you override `buildDir` to point inside the project, add it to `.gitignore`.

Of course, you can change these. Specify them in the Vite plugin options.

You might find it odd that the built binary is placed in `src/wasm/`, but this is because the Vite server defaults to a path where it can easily access WASM binaries.
A WASM binary placed here can be called using boilerplate code like the following:

```typescript
// Load WASM binary
const wasmUrl = new URL('./wasm/add.wasm', import.meta.url);
const response = await fetch(wasmUrl);
const wasmBuffer = await response.arrayBuffer();

// Instantate with the WASM runtime
const { instance } = await WebAssembly.instantiate(wasmBuffer, {});

// Retrieve exposed function endpoints within a WASM binary
const exports = instance.exports as {
  add?: (a: number, b: number) => number;
  _add?: (a: number, b: number) => number;
};
const add = exports.add ?? exports._add;
if (typeof add !== 'function') {
  throw new Error('add function not found in wasm exports.');
}

// Invoke WASM function
const result = add(1, 2);
```

### Specifying Source Files

By default, files matching `wasm/**/*.c` and `wasm/**/*.cpp` are treated as source files and built.
The leading `wasm/` directory is the "source root directory", and any source file under it becomes a compile target.

To change this, explicitly set `srcDir` and/or `sources`:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // Explicitly set the source root directory
      srcDir: 'wasm',
      targets: {
        add: {
          // Explicitly specify source file patterns
          sources: ['**/*.c++', '**/*.cpp'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

- `srcDir` is also used as the root directory that the Vite plugin watches for source changes. Files outside `srcDir` will not trigger rebuilds during the Vite dev server.

### Source Groups

Building a single WASM binary may require compiling different sources with different options.
In that case, use "source groups" to split source files into groups:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        add: {
          // Compile options (common)
          options: ['-O3', '-std=c99'],
          // Define source groups
          sourceGroups: [
            {
              sources: ['opt/**/*.c'],
              defines: { OPT: 1 }, // -DOPT=1
            },
            {
              sources: ['opt/**/*.c'],
              defines: { OPT: 2 }, // -DOPT=2
            },
          ],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

In the above case, compilation runs as follows:

- Sources under `opt/` are compiled with `OPT=1`.
- Sources under `opt/` are compiled with `OPT=2`.
- All other sources are compiled without additional defines. (Sources under `wasm/` are still targets, except those covered above.)

All of these object files are linked together to produce `add.wasm`.
Therefore, take care to avoid symbol collisions for sources under `opt/`.

If you compile unrelated source sets with different options, there is no problem.

### Building Multiple WASM Binaries

You may want to generate multiple WASM binaries in a single project.
In that case, add multiple entries under `targets`:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        // Build "add.wasm"
        add: {
          options: ['-O3', '-std=c99'],
          defines: { OPERATOR: 'ADD' },

          //  :
          //  :
        },
        // Build "mul.wasm"
        mul: {
          options: ['-O3', '-std=c99'],
          defines: { OPERATOR: 'MUL' },

          //  :
          //  :
        },
      },
    }),
  ],
});
```

You can split `targets` as above, but when the same options repeat, use `common` to share them:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      common: {
        // Common compile options
        options: ['-O3', '-std=c99'],
      },
      targets: {
        // Build "add.wasm"
        add: {
          defines: { OPERATOR: 'ADD' },

          //  :
          //  :
        },
        // Build "mul.wasm"
        mul: {
          defines: { OPERATOR: 'MUL' },

          //  :
          //  :
        },
      },
    }),
  ],
});
```

TODO:

---

## License

Under MIT.
