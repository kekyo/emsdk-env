# emsdk-env

Emscripten SDKを使用して、WASM C/C++ソースコードの自動ビルドを実行するViteプラグイン

![emsdk-env](./images/emsdk-env-120.png)

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/emsdk-env.svg)](https://www.npmjs.com/package/emsdk-env)

---

[(English language is here.)](./README.md)

WIP:

## これは何?

これは、Emscripten SDKを自動的にダウンロードして管理し、プロジェクト内のWASM C/C++コードを自動的にビルド可能にする、Viteプラグインです。
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
          linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
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

---

## 使用方法

### インストール

`devDependencies`に追加して下さい（emsdk-env自体は、実行時コードを必要としません）:

```bash
$ npm install -D emsdk-env
```

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

### ソースファイルの指定

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

### ソースグループ

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

### 複数のWASMバイナリをビルド

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
          defines: {'OPERATOR': 'ADD'},

          //  :
          //  :
        },
        // "mul.wasm" のビルド
        mul: {
          options: ['-O3', '-std=c99'],
          defines: {'OPERATOR': 'MUL'},

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
          defines: {'OPERATOR': 'ADD'},

          //  :
          //  :
        },
        // "mul.wasm" のビルド
        mul: {
          defines: {'OPERATOR': 'MUL'},

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
