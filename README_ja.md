# emsdk-env

Emscripten SDKを使用して、WASM C/C++ソースコードの自動ビルドを実行するViteプラグイン

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
      // 共通のビルドオプション
      common: {
        options: ['-O3', '-std=c99'],
        linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
      },
      // ビルドターゲット
      targets: {
        // "add.wasm"を生成
        add: {
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

TODO:

---

## License

Under MIT.
