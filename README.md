# emsdk-env

A Vite plugin that automatically builds WASM C/C++ source code using the Emscripten SDK.

![emsdk-env](./images/emsdk-env-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/emsdk-env.svg)](https://www.npmjs.com/package/emsdk-env)

---

[(Japanese language is here/日本語はこちら)](./README_ja.md)

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

If the WASM binary is located in a non-default directory, you can also explicitly specify the source:

```typescript
// Load WASM binary with target source
const wasm = await loadAddWasm<AddExports>({
  source: new URL('./alternate/add.wasm', import.meta.url),
});
```

If you plan to operate with the default settings, there is essentially no configuration work required.

Other topics include features such as explicitly specifying source files,
applying multiple compile options separately, handling multiple target outputs,
generating and referencing archive library files, and compilation and referencing NPM packages.

We will cover these starting in the next chapter.

---

## Preprocessor Macros and Linker Directives

When compiling C/C++ sources, you can define preprocessor macros with command-line options like `-DOPT=1`.
In emsdk-env, you can do this via `options`, but `defines` is supported as a dedicated field.

Likewise, you can pass additional linker directives to the Emscripten SDK at link time, for example `-s STANDALONE_WASM=1`.
In emsdk-env, you can do this via `linkOptions`, but `linkDirectives` is supported as a dedicated field.

Here is an example:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        add: {
          // Define preprocessor macros `-DOPT=1`
          defines: { OPT: 1 },
          // Define linker directives `-s STANDALONE_WASM=1`
          linkDirectives: {
            STANDALONE_WASM: 1,
            EXPORTED_RUNTIME_METHODS: ['wasmMemory'],
          },

          //  :
          //  :
        },
      },
    }),
  ],
});
```

- `defines` and `linkDirectives` can be provided as objects as shown above, and they also accept `Map` or `string[]`.
- For `string[]`, separate key and value with `=` as in `'OPT=1'`.
- To omit a value (e.g. `-DOPT`), set the value to `undefined` or `null`. For string entries, a definition without `=` is treated as a key without a value.
- `defines` values are scalar-only (`string | number | boolean | null | undefined`).
- `linkDirectives` values also accept `string[]`, which is emitted as JSON list syntax like `-s EXPORTED_RUNTIME_METHODS=["wasmMemory"]`.

## Specifying Source Files

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

- `srcDir` is also used as the root directory that the Vite plugin watches for source changes.
  Files outside `srcDir` will not trigger rebuilds during the Vite dev server.

## Source Groups

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

## Building Multiple WASM Binaries

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

## Archive Libraries

emsdk-env also supports building and using archive libraries (`*.a`).
To build one, set `type: 'archive'` on the target:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        libcalc: {
          // Generate "libcalc.a"
          type: 'archive',

          //  :
          //  :
        },
      },
    }),
  ],
});
```

Archive libraries are placed under `lib/` by default (unlike WASM binaries).
You can change this directory with `libDir`.

`lib/` is also included in the default linker options as `-Llib`.
That means you can reference the archive with just `-lcalc` at link time:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // Explicitly set the archive base directory
      libDir: 'wasm-lib',
      targets: {
        // "libcalc.a"
        libcalc: {
          type: 'archive',

          //  :
          //  :
        },
        // "offload.wasm"
        offload: {
          // Reference "libcalc.a"
          linkOptions: ['-lcalc'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

Note: The Emscripten SDK uses archive library filenames with the `lib...` prefix, such as `libcalc.a`, as a convention.
Therefore, apply the prefix similarly to the target name, such as `libcalc: { ... }`.
While builds are possible without the prefix and can generate archive library files
like `calc.a`, linking with `-lcalc` will not work without the prefix.

## Distribute Libraries as an NPM Package

With emsdk-env, you can package and distribute your header files and WASM archives.
The key point is to place include files and archive libraries under fixed directories:

```
project/
├── package.json
├── vite.config.ts
├── wasm/
│   └── add.c
├── include/
│   └── calc.h      // Include files
└── lib/
    └── libcalc.a   // Archive libraries
```

With this structure, just add `include` and `lib` to `files` in `package.json`:

```json
{
  "files": ["include", "lib"]

  //  :
  //  :
}
```

If you changed `includeDir` or `libDir`, add an `emsdk-env` key to `package.json`:

```json
{
  "files": ["inc", "wasm-lib"],
  "emsdk-env": {
    "include": "inc",
    "lib": "wasm-lib"
  }

  //  :
  //  :
}
```

Note: The `imports` explained in the next section resolve packages using Node's module resolution (equivalent to `require.resolve`).
Therefore, the package must have resolvable entries such as `main`, `exports`, or `index.js`.
When distributing only headers and `.a` files, include an empty `dummy.js` or similar.
For example, define `package.json` as follows to include an empty `dummy.js`:

```json
{
  "name": "wasm-calc-lib",
  "version": "1.0.0",
  "main": "dummy.js",
  "files": ["dummy.js", "include", "lib"]
}
```

### Referencing a WASM NPM Package

Packages built as above can be installed like any other NPM package.
Normally, install them in `devDependencies`, because once the WASM binary is built,
the package's include files and archive libraries are no longer needed:

```bash
$ npm install -D wasm-calc-lib
```

On the emsdk-env side, specify which packages to use via `imports`:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // Use the library from "wasm-calc-lib"
      imports: ['wasm-calc-lib'],
      targets: {
        // "offload.wasm"
        offload: {
          // Reference "libcalc.a" from "wasm-calc-lib"
          linkOptions: ['-lcalc'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

Each target can now reference include files and archive libraries from the specified packages.

Others:

- The search order follows the order in `imports`.
  If you get symbol collisions, adjust the package order.
- If you installed a referenced package in `devDependencies`, resolution fails in these cases: `npm ci --omit=dev`;
  `npm install` with `NODE_ENV=production`;
  or when build and runtime environments are split and runtime omits devDependencies.
  In those cases, install it as a normal dependency and make sure include/archive files are not shipped in the final artifact.
- When using yarn, files inside the package may not be accessible by default.
  Use `nodeLinker: node-modules` or mark the target package as unplugged so it is materialized.

## Additional Optimization with wasm-opt

“wasm-opt” is a utility included in the Emscripten SDK that performs additional optimizations.
It is implemented by [Binaryen](https://github.com/WebAssembly/binaryen).

It takes a WASM binary as input and outputs a new, optimized WASM binary.

emsdk-env can use wasm-opt to perform additional optimizations on the link result:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        // “offload.wasm”
        offload: {
          // Execute additional optimizations using wasm-opt
          wasmOpt: {
            enable: true,
            options: ['-Oz', '--enable-simd'],
          },

          //  :
          //  :
        },
      },
    }),
  ],
});
```

`wasmOpt.enable` is `false` by default. Therefore, explicitly set it to `true` when using wasm-opt.
Using this, you can specify only `wasmOpt.options` in `common` and control whether to apply wasm-opt for each target via `wasmOpt.enable`.

## Vite Options

The options accepted by `emsdk-env/vite` (`EmsdkVitePluginOptions`) are:

| Key               | Type                                     | Default                       | Description                                                                                        |
| :---------------- | :--------------------------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------- |
| `emsdk`           | `PrepareEmsdkOptions`                    | `{ targetVersion: 'latest' }` | Emscripten SDK setup.                                                                              |
| `srcDir`          | `string`                                 | `'wasm'`                      | Root directory for C/C++ sources (project-root relative).                                          |
| `includeDir`      | `string`                                 | `'include'`                   | Default include directory (project-root relative).                                                 |
| `outDir`          | `string`                                 | `'src/wasm'`                  | WASM output directory (project-root relative).                                                     |
| `libDir`          | `string`                                 | `'lib'`                       | Archive output directory (project-root relative).                                                  |
| `buildDir`        | `string`                                 | `<OS temp>/emsdk-env`         | Temporary build directory.                                                                         |
| `cleanupBuildDir` | `boolean`                                | `true`                        | Whether to delete the temp directory after build.                                                  |
| `imports`         | `string[]`                               | `[]`                          | NPM packages to reference. Auto-detects `include`/`lib` and adds `-I`/`-L` accordingly.            |
| `generatedLoader` | `{ enable?: boolean; outFile?: string }` | `undefined`                   | Generate a zero-dependency TypeScript WASM loader into the target project when `enable` is `true`. |
| `common`          | `WasmBuildCommonOptions`                 | `undefined`                   | Common settings applied to all targets.                                                            |
| `targets`         | `Record<string, WasmBuildTarget>`        | Required                      | Target definitions, keyed by target name.                                                          |

When `generatedLoader.enable` is `true`, the default output path is `src/generated/wasm-loader.ts`.
The generated file contains `loadWasm<T>()`, `WasmInstance<T>`, and target wrappers such as `loadAddWasm<T>()`.
Do not place `generatedLoader.outFile` under watched source/include directories such as `srcDir` or `includeDirs`.

The main keys available under `common` and `targets` are:

| Key              | Type                                                                                                                      | Default                        | Description                                                                                                                                                                                                                                                                                                                                                                          |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------ | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `'wasm' \| 'archive'`                                                                                                     | `'wasm'`                       | Output type. `archive` produces `.a`.                                                                                                                                                                                                                                                                                                                                                |
| `outFile`        | `string`                                                                                                                  | `<target>.wasm` / `<target>.a` | Output file name (relative to `outDir` / `libDir`).                                                                                                                                                                                                                                                                                                                                  |
| `sources`        | `string[]`                                                                                                                | `['**/*.c', '**/*.cpp']`       | Source globs (relative to `srcDir`).                                                                                                                                                                                                                                                                                                                                                 |
| `sourceGroups`   | `WasmBuildSourceGroup[]`                                                                                                  | `[]`                           | Source groups with additional options.                                                                                                                                                                                                                                                                                                                                               |
| `options`        | `string[]`                                                                                                                | `[]`                           | Extra options passed to `emcc -c`.                                                                                                                                                                                                                                                                                                                                                   |
| `linkOptions`    | `string[]`                                                                                                                | `[]`                           | Extra linker options. Not available for `archive`.                                                                                                                                                                                                                                                                                                                                   |
| `linkDirectives` | `Record<string, DefineValue \| readonly string[]> \| Readonly<Map<string, DefineValue \| readonly string[]>> \| string[]` | `{}`                           | Linker directives mapped to `-s KEY=VALUE`. Object/Map values accept both scalar values and `string[]`; array values are emitted as JSON list syntax such as `EXPORTED_RUNTIME_METHODS=["wasmMemory"]`. `string[]` entries are parsed as `KEY=VALUE` (value is string), or `KEY` (treated as `KEY=undefined`). Use `null`/`undefined` to emit `-s KEY`. Not available for `archive`. |
| `exports`        | `string[]`                                                                                                                | `[]`                           | Exports passed via `-s EXPORTED_FUNCTIONS=...`. Not available for `archive`.                                                                                                                                                                                                                                                                                                         |
| `wasmOpt`        | `WasmOptOptions`                                                                                                          | `undefined`                    | wasm-opt options (enable defaults to false; common options default to `['-Oz']`). If the output is not `.wasm` (e.g. `.js`/`.mjs`/`.html`), wasm-opt runs on the associated `.wasm` (uses `WASM_BINARY_FILE` if set, otherwise `<basename>.wasm`). Not available for `archive`.                                                                                                      |
| `includeDirs`    | `string[]`                                                                                                                | `[]`                           | Additional include directories (`-I`).                                                                                                                                                                                                                                                                                                                                               |
| `defines`        | `Record<string, DefineValue> \| Readonly<Map<string, DefineValue>> \| string[]`                                           | `{}`                           | Macro definitions (`-D`). Values are scalar-only. `string[]` entries are parsed as `KEY=VALUE` (value is string), or `KEY` (treated as `KEY=undefined`). Use `null`/`undefined` to emit `-DKEY`.                                                                                                                                                                                     |

`PrepareEmsdkOptions` supports:

| Key             | Type          | Default                                      | Description                        |
| :-------------- | :------------ | :------------------------------------------- | :--------------------------------- |
| `targetVersion` | `string`      | `'latest'`                                   | Emscripten SDK version to install. |
| `cacheDir`      | `string`      | `~/.cache/emsdk-env`                         | SDK cache location.                |
| `repoUrl`       | `string`      | `'https://github.com/emscripten-core/emsdk'` | emsdk repository URL.              |
| `gitPath`       | `string`      | `'git'`                                      | `git` executable to use.           |
| `signal`        | `AbortSignal` | `undefined`                                  | Abort signal for cancellation.     |

---

## License

Under MIT.
