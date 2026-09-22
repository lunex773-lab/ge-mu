# lab/ — Boss Neural Core

BOSS NEURAL CORE 仕様書 (v1.0) の実装ラボ。**ここは出荷されません。**

ゲーム本体 (`../index.html`) は今までどおり単体で開けば動きます。ビルドは不要です。

## 走らせ方

依存関係はありません。node だけで動きます。

```sh
node lab/test/phase1.test.js      # テスト
node lab/bench/phase1.bench.js    # ノード数別の実測と戦略比較
```

## 構成

```
lab/core/rng.js          決定論的乱数。全ての確率的選択はここを通る
lab/core/connectome.js   Neuron / Synapse / Graph / Mock生成 / 指標  (§5–§7)
lab/core/compress.js     圧縮戦略5種と比較                           (§8)
lab/test/                テスト                                      (§33)
lab/bench/               性能と戦略の実測                            (§8, §33)
```

## データについて (§27)

**FlyWire の実データはこのリポジトリに含まれていません。** Mock のみで全工程を進める方針です（D3）。
実データを導入する場合は、ライセンス・利用条件・再配布制限を確認したうえで `lab/data/` に置き、
`.gitignore` してください。`Graph` が契約なので、ローダーを差し替えるだけで下流は変わりません。

## 科学的な表現について (§26)

このプロジェクトは **connectome-inspired abstraction** です。
「ハエの脳と同じ」「ニューロンを完全再現」といった主張はしません。
`connectome.js` の機能クラス（SENSORY / MOTOR など）は**ゲーム側の抽象**であり、
生物学的事実の断定ではありません。
