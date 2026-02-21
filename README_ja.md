# emsdk-env

Emscripten SDKを使用して、WASM C/C++ソースコードの自動ビルドを実行するViteプラグイン

![emsdk-env](./images/emsdk-env-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/emsdk-env.svg)](https://www.npmjs.com/package/emsdk-env)

---

[(English language is here.)](./README.md)

## これは何?

これは、 [Emscripten SDK](https://github.com/emscripten-core/emsdk) を自動的にダウンロードして管理し、プロジェクト内のWASM C/C++コードを自動的にビルド可能にする、Viteプラグインです。
このプラグインを使用すれば、あなたのViteプロジェクトに、簡単にWASM C/C++開発環境を構築できます。

使い方は簡単です。このViteプラグインパッケージをあなたのプロジェクトに追加して、以下のように`vite.config`でプラグインを初期化するだけです:

```typescript
// `vite.config.ts`
import { defineConfig } from 'vite';

// emsdk-envのViteプラグインを参照
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    // プラグインとして追加
    emsdkEnv({
      // ビルドターゲット
      targets: {
        // "add.wasm"を生成
        add: {
          // コンパイルオプション
          options: ['-O3', '-std=c99'],
          // リンクオプション
          linkOptions: ['--no-entry'],
          // リンクディレクティブ
          linkDirectives: { STANDALONE_WASM: 1 },
          // エクスポートシンボル
          exports: ['_add'],
        },
      },
    }),
  ],
});
```

ソースコードが変更されれば、自動的に再ビルドされてページがリロードされます。
あなたは、TypeScript/JavaScriptのコードと同様に、C/C++コードの記述に専念出来ます！

### 特徴

- Emscripten SDKの自動セットアップ・キャッシュ
- Viteプラグインによる、HMR対応（但しC/C++コードは全体ビルドが行われます）
- 並行ビルド対応
- エクスポートシンボルの簡易指定が可能
- 複数のターゲットWASMバイナリを生成可能
- ディレクトリパス・コンパイルオプション・リンカオプションのカスタマイズが可能
- アーカイブライブラリ(`*.a`)のビルドと参照が可能
- NPMパッケージでWASMライブラリの配布と参照が可能

---

## 使用方法

### インストール

`devDependencies`に追加して下さい（emsdk-env自体は、実行時コードを必要としません）:

```bash
$ npm install -D emsdk-env
```

- emsdk-envは、Emscripten SDKを自動的にダウンロードしてキャッシュします（位置は `~/.cache/emsdk-env/` 配下です）。
  従って、手動でEmscripten SDKをセットアップする必要はありません。

### C/C++ソースコードとバイナリの配置

デフォルトでは、C/C++ソースコードはプロジェクト配下の`wasm/`ディレクトリに配置され、
ビルドされたWASMバイナリは`src/wasm/`ディレクトリに配置されます。

典型的には、以下のようなディレクトリ構造です:

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

- 上記の他に、OS のテンポラリディレクトリ配下にビルド用の一時ディレクトリが作られます。
  デフォルトの場所は `${TMPDIR}/emsdk-env`（Unix では通常 `/tmp/emsdk-env`）です。
  これはビルド時に使われ、通常はビルド後に削除されます。
  `buildDir` をプロジェクト配下に変更した場合は、そのパスを `.gitignore` に含めることを推奨します。

もちろん、これらは変更することが出来ます。Viteプラグインの引数に指定します。

ビルドされたバイナリが`src/wasm/`に配置される事に違和感を感じるかもしれませんが、これはViteサーバーがデフォルトでWASMバイナリに容易にアクセスできるパスだからです。
このように配置されたWASMバイナリは、以下のようなボイラープレートコードで呼び出し可能になります:

```typescript
// WASMバイナリを読み込む
const wasmUrl = new URL('./wasm/add.wasm', import.meta.url);
const response = await fetch(wasmUrl);
const wasmBuffer = await response.arrayBuffer();

// WASMランタイムで実体化させる
const { instance } = await WebAssembly.instantiate(wasmBuffer, {});

// WASMバイナリ内の公開された関数エンドポイントを取得する
const exports = instance.exports as {
  add?: (a: number, b: number) => number;
  _add?: (a: number, b: number) => number;
};
const add = exports.add ?? exports._add;
if (typeof add !== 'function') {
  throw new Error('add function not found in wasm exports.');
}

// 関数を呼び出す
const result = add(1, 2);
```

デフォルトのままで運用するなら、ほぼこれで構成作業はありません。

他のトピックとしては、ソースファイルの明示的な指定、複数のコンパイルオプションの分離適用、複数のターゲット出力を扱う方法、アーカイブライブラリファイルの生成と参照、NPMパッケージの生成と参照、と言った機能があります。

次の章より、これらについて説明します。

---

## プリプロセッサマクロ・リンクディレクティブの指定

C/C++ソースコードをコンパイルする場合、コマンドラインオプションで `-DOPT=1` のように指定することで、プリプロセッサマクロを定義できます。
emsdk-envでこれを指定する場合は、 `options` で指定することも出来ますが、 `defines` を使用できます。

同様に、リンク時にEmscripten SDKに追加のリンクディレクティブを指定できます。例えば `-s STANDALONE_WASM=1` のように指定します。
emsdk-envでこれを指定する場合は、 `linkOptions` で指定することも出来ますが、 `linkDirectives` を使用できます。

これらの例を示します:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        add: {
          // プリプロセッサマクロの定義 `-DOPT=1`
          defines: { OPT: 1 },
          // リンクディレクティブの定義 `-s STANDALONE_WASM=1`
          linkDirectives: { STANDALONE_WASM: 1 },

          //  :
          //  :
        },
      },
    }),
  ],
});
```

- `defines` と `linkDirectives` は、上記例のようにオブジェクト定義として指定できますが、その他に `Map` や文字列の配列も受け付けます。
- 文字列の配列を指定する場合は、 `'OPT=1'` のように、key-valueを `'='` で区切ります。
- valueを省略する場合(`-DOPT` など)は、値に `undefined` または `null` を指定します。文字列で指定する場合は、`'='` で区切らなければ値のない定義となります。

## ソースファイルの指定

デフォルトでは、 `wasm/**/*.c`, `wasm/**/*.cpp` に対応するファイル群をソースファイルとみなしてビルドを行います。
先頭の `wasm/` ディレクトリは「ソースファイル基底ディレクトリ」であり、そのディレクトリ配下のソースファイルがコンパイルの対象です。

これを変更するには、 `srcDir` や `sources` を明示的に指定します:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // ソースファイル基底ディレクトリを明示的に指定
      srcDir: 'wasm',
      targets: {
        add: {
          // ソースファイル群を明示的に指定
          sources: ['**/*.c++', '**/*.cpp'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

- `srcDir` はこの他にも、Viteプラグインがソースコードの変更を監視する起点となるディレクトリとして扱われます。
  つまり、 `srcDir` ディレクトリ内に存在しないファイル群は、Viteサーバー実行時に変更を検出できません。

## ソースグループ

一つのWASMバイナリを生成するのに、複数の異なるオプションを適用したコンパイルを必要とする場合があります。
そのような場合は「ソースグループ」を使用して、ソースファイル群を分割定義します:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        add: {
          // コンパイルオプション（共通）
          options: ['-O3', '-std=c99'],
          // ソースグループの定義
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

上記の場合、以下のようにコンパイルが実行されます:

- `opt/`ディレクトリ配下のソースコードについて、`OPT=1`でコンパイルを行う。
- `opt/`ディレクトリ配下のソースコードについて、`OPT=2`でコンパイルを行う。
- それ以外の全てのソースコードは、追加defineなし。
  （引き続き、`wasm/`ディレクトリ配下のソースコードはコンパイル対象なので、上記を除いてコンパイルされます）

そして、これらが全てリンカで結合されて `add.wasm` が生成されます。
従って、`opt/`配下のソースコードは、生成されるシンボルが重複しないように注意する必要があります。

もちろん、互いに関係のないソースファイル群を異なるオプションでコンパイルするのであれば、問題はありません。

## 複数のWASMバイナリをビルド

一つのプロジェクト内で、複数のWASMバイナリを生成する場合もあります。
そのような場合は、 `targets` に複数のエントリを記述します:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        // "add.wasm" のビルド
        add: {
          options: ['-O3', '-std=c99'],
          defines: { OPERATOR: 'ADD' },

          //  :
          //  :
        },
        // "mul.wasm" のビルド
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

上記のように `targets` を分割できますが、同じオプション定義が続くような場合は、 `common` を使用して定義を共通化出来ます:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      common: {
        // 共通のコンパイルオプション
        options: ['-O3', '-std=c99'],
      },
      targets: {
        // "add.wasm" のビルド
        add: {
          defines: { OPERATOR: 'ADD' },

          //  :
          //  :
        },
        // "mul.wasm" のビルド
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

## アーカイブライブラリ

emsdk-envはアーカイブライブラリ(`*.a`)のビルドと利用もサポートしています。
ビルドを行うには、ターゲットに`type: 'archive'`を指定するだけです:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        libcalc: {
          // "libcalc.a"を生成する
          type: 'archive',

          //  :
          //  :
        },
      },
    }),
  ],
});
```

アーカイブライブラリファイルは、WASMバイナリとは異なり、デフォルトで `lib/` ディレクトリに配置されます。
このディレクトリは `libDir` で変更できます。

また、 `lib/` はデフォルトのリンカーオプションに `-Llib` のように指定されています。
したがって、リンク時に `-lcalc` と指定するだけでこのアーカイブライブラリファイルを参照できます:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // アーカイブライブラリファイル基底ディレクトリを明示的に指定
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
          // "libcalc.a"を参照
          linkOptions: ['-lcalc'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

注意:

- Emscripten SDKでは、慣例として `libcalc.a` のように `lib...` プレフィックスを付与したアーカイブライブラリファイル名を使用します。
  従って、ターゲット名も同様に `libcalc: { ... }` のようにプレフィックスを適用して下さい。
  プレフィックスが無くてもビルドは可能で、 `calc.a` のようなアーカイブライブラリファイルを生成できますが、そのままではリンク時に `-lcalc` の指定でリンクすることは出来なくなります。

## NPMパッケージにしてライブラリを配布

emsdk-envを使用すれば、あなたのヘッダファイルとWASMアーカイブとパッケージ化して配布することも出来ます。
パッケージ化する時に押さえるべきポイントは、インクルードファイル群とアーカイブライブラリファイル群を、特定のディレクトリに配置しておくことです:

```
project/
├── package.json
├── vite.config.ts
├── wasm/
│   └── add.c
├── include/
│   └── calc.h      // インクルードファイル群
└── lib/
    └── libcalc.a   // アーカイブライブラリファイル群
```

このディレクトリ構成であれば、 `package.json` の `files` キーに `include` と `lib` を加えるだけで完了です:

```json
{
  "files": ["include", "lib"]

  //  :
  //  :
}
```

`includeDir` や `libDir` を変更している場合は、 `package.json` に `emsdk-env` キーを加える必要があります:

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

補足: 次節で解説する `imports` は、Nodeのモジュール解決（`require.resolve` 相当）でパッケージを解決します。
そのため、パッケージ側に `main` / `exports` / `index.js` などの解決可能なエントリが必要です。
ヘッダと `.a` だけを配布する場合は、空の `dummy.js` などを同梱してください。
例えば、`package.json` を次のように定義して、空の `dummy.js` を含めます:

```json
{
  "name": "wasm-calc-lib",
  "version": "1.0.0",
  "main": "dummy.js",
  "files": ["dummy.js", "include", "lib"]
}
```

### WASM NPMパッケージを参照する

上記のようにして生成したNPMパッケージは、一般的なNPM運用と同様に、パッケージ依存関係でインストール出来ます。
通常は `devDependencies` にインストールして下さい。なぜなら、WASMバイナリがビルドされたら、もはやパッケージ側のインクルードファイルやアーカイブライブラリファイルは必要ないからです:

```bash
$ npm install -D wasm-calc-lib
```

そして、emsdk-env側では、どのパッケージをWASMビルドで使用するかを `imports` で指定します:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      // "wasm-calc-lib"パッケージのライブラリを使用する
      imports: ['wasm-calc-lib'],
      targets: {
        // "offload.wasm"
        offload: {
          // "wasm-calc-lib"パッケージの"libcalc.a"を参照
          linkOptions: ['-lcalc'],

          //  :
          //  :
        },
      },
    }),
  ],
});
```

これで、各ターゲットは指定されたパッケージのインクルードファイルとアーカイブライブラリファイルを参照できます。

その他:

- インクルードファイルとアーカイブライブラリファイルの探索順序は、 `imports` に指定したパッケージの順序に従います。
  シンボル競合が発生する場合は、パッケージ順序を調整して下さい。
- 参照パッケージを `devDependencies` にインストールした場合は、以下の場合に参照に失敗するため、その場合は通常の参照としてインストールし、
  最終成果物にインクルードファイルやアーカイブライブラリファイルが含まれないようにして下さい:
  - CI/CD や本番ビルドで `npm ci --omit=dev` を使う
  - NODE_ENV=production を設定して `npm install` する
  - ビルド時と実行時の環境を分けており、実行環境には devDependencies を入れない運用
- yarnを使用する場合は、デフォルトではパッケージ内のファイルを参照出来ない可能性があります。
  その場合は、 `nodeLinker: node-modules` を使うか、対象パッケージをunpluggedにして実体化する必要があります。

## wasm-optで追加最適化

"wasm-opt"とは、Emscripten SDKに含まれる、追加の最適化を行うユーティリティです
[Binaryen](https://github.com/WebAssembly/binaryen) によって実現されます。

WASMバイナリを入力として、最適化を施した新しいWASMバイナリを出力します。

emsdk-envは、wasm-optを使用してリンク結果に対して追加の最適化を行うことが出来ます:

```typescript
export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        // "offload.wasm"
        offload: {
          // wasm-optを使用して追加最適化の実行
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

`wasmOpt.enable` は既定では `false` です。従って、wasm-optを使用する場合は明示的に `true` を指定して下さい。
この事を利用して、`common` に `wasmOpt.options` のみ指定して、各ターゲットでwasm-optを適用するかどうかを `wasmOpt.enable` で制御できます。

## Viteオプション一覧

`emsdk-env/vite` に渡すオプション（`EmsdkVitePluginOptions`）の一覧です。

| キー              | 型                                | デフォルト                    | 説明                                                                       |
| :---------------- | :-------------------------------- | :---------------------------- | :------------------------------------------------------------------------- |
| `emsdk`           | `PrepareEmsdkOptions`             | `{ targetVersion: 'latest' }` | Emscripten SDKの取得設定。                                                 |
| `srcDir`          | `string`                          | `'wasm'`                      | C/C++ソースのルートディレクトリ（プロジェクトルート相対）。                |
| `includeDir`      | `string`                          | `'include'`                   | デフォルトのインクルードディレクトリ（プロジェクトルート相対）。           |
| `outDir`          | `string`                          | `'src/wasm'`                  | WASM出力ディレクトリ（プロジェクトルート相対）。                           |
| `libDir`          | `string`                          | `'lib'`                       | アーカイブ出力ディレクトリ（プロジェクトルート相対）。                     |
| `buildDir`        | `string`                          | `<OSのテンポラリ>/emsdk-env`  | 一時ビルドディレクトリ。                                                   |
| `cleanupBuildDir` | `boolean`                         | `true`                        | ビルド後に一時ディレクトリを削除するか。                                   |
| `imports`         | `string[]`                        | `[]`                          | 参照するNPMパッケージ名。`include`/`lib` を自動検出して `-I`/`-L` を追加。 |
| `common`          | `WasmBuildCommonOptions`          | `undefined`                   | 全ターゲットに適用する共通設定。                                           |
| `targets`         | `Record<string, WasmBuildTarget>` | 必須                          | ターゲット定義。キーがターゲット名。                                       |

`common` と `targets` 内で使える主なキーは以下です。

| キー             | 型                                                                              | デフォルト                     | 説明                                                                                                                                                                                                                                                                                            |
| :--------------- | :------------------------------------------------------------------------------ | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `'wasm' \| 'archive'`                                                           | `'wasm'`                       | 出力形式。`archive` は `.a` を生成。                                                                                                                                                                                                                                                            |
| `outFile`        | `string`                                                                        | `<target>.wasm` / `<target>.a` | 出力ファイル名（`outDir` / `libDir` 相対）。                                                                                                                                                                                                                                                    |
| `sources`        | `string[]`                                                                      | `['**/*.c', '**/*.cpp']`       | 対象ソース（`srcDir` 相対）。                                                                                                                                                                                                                                                                   |
| `sourceGroups`   | `WasmBuildSourceGroup[]`                                                        | `[]`                           | 追加オプション付きのソースグループ。                                                                                                                                                                                                                                                            |
| `options`        | `string[]`                                                                      | `[]`                           | `emcc -c` に渡す追加オプション。                                                                                                                                                                                                                                                                |
| `linkOptions`    | `string[]`                                                                      | `[]`                           | リンク時の追加オプション。`archive` では使用不可。                                                                                                                                                                                                                                              |
| `linkDirectives` | `Record<string, DefineValue> \| Readonly<Map<string, DefineValue>> \| string[]` | `{}`                           | `-s KEY=VALUE` に対応するリンク指示。`string[]` は `KEY=VALUE`（値は文字列）または `KEY`（`KEY=undefined` 相当）として解釈します。`null`/`undefined` で `-s KEY` を出力します。`archive` では使用不可。                                                                                         |
| `exports`        | `string[]`                                                                      | `[]`                           | `-s EXPORTED_FUNCTIONS=...` で指定するエクスポート。`archive` では使用不可。                                                                                                                                                                                                                    |
| `wasmOpt`        | `WasmOptOptions`                                                                | `undefined`                    | wasm-opt の設定（enableのデフォルトは無効、commonのoptionsは `['-Oz']`）。出力が `.wasm` 以外（例: `.js`/`.mjs`/`.html`）の場合は、対応する `.wasm` に対して wasm-opt を実行します（`WASM_BINARY_FILE` が指定されていればそれを使用し、未指定なら `<basename>.wasm`）。`archive` では使用不可。 |
| `includeDirs`    | `string[]`                                                                      | `[]`                           | `-I` を追加するインクルードディレクトリ。                                                                                                                                                                                                                                                       |
| `defines`        | `Record<string, DefineValue> \| Readonly<Map<string, DefineValue>> \| string[]` | `{}`                           | `-D` を追加するマクロ定義。`string[]` は `KEY=VALUE`（値は文字列）または `KEY`（`KEY=undefined` 相当）として解釈します。`null`/`undefined` で `-DKEY` を出力します。                                                                                                                            |

`emsdk` に指定できる `PrepareEmsdkOptions` は以下の通りです。

| キー            | 型            | デフォルト                                   | 説明                                           |
| :-------------- | :------------ | :------------------------------------------- | :--------------------------------------------- |
| `targetVersion` | `string`      | `'latest'`                                   | インストールする Emscripten SDK のバージョン。 |
| `cacheDir`      | `string`      | `~/.cache/emsdk-env`                         | SDKキャッシュの保存先。                        |
| `repoUrl`       | `string`      | `'https://github.com/emscripten-core/emsdk'` | emsdkリポジトリのURL。                         |
| `gitPath`       | `string`      | `'git'`                                      | 使用する `git` 実行ファイル。                  |
| `signal`        | `AbortSignal` | `undefined`                                  | 処理中断用シグナル。                           |

---

## License

Under MIT.
