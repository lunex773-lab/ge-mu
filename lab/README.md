# lab/ — Boss Neural Core

BOSS NEURAL CORE 仕様書 (v1.0) の実装ラボ。**ここは出荷されません。**

ゲーム本体 (`../index.html`) は今までどおり単体で開けば動きます。ビルドは不要です。

## 走らせ方

依存関係はありません。node だけで動きます。

```sh
node lab/test/phase1.test.js          # Phase 1: Mock Connectome / 圧縮
node lab/test/phase2.test.js          # Phase 2: Neural Core
node lab/test/phase3.test.js          # Phase 3: WorldState / Sensor Layer / Game Adapter
node lab/test/phase4.test.js          # Phase 4: FairnessController
node lab/bench/phase1.bench.js        # ノード数別の実測と戦略比較
node lab/bench/phase2.bench.js        # Neural Core のノード数別コスト
node --expose-gc lab/bench/phase3.bench.js   # センサーのコスト（プレイヤー数別）
```

### 本物のゲームに対するテスト

`*.game.test.js` は `index.html` を headless Chromium で実際に動かします（Playwright が必要）。
複数のブラウザコンテキスト＝別々のスマホとして同じルームに入れ、MQTT はテストプロセス経由で中継します。

```sh
node lab/test/phase3.game.test.js     # アダプタが本物のゲームを「読むだけ」であることの検証
node lab/test/gatesync.game.test.js   # ルーム全員が同じゲートを見ること（約3分）
```

`lab/test/harness/page.js` が `lab/.cache/game.html` を生成します（three.js は初回に `npm pack` で取得、
`.cache` は gitignore）。ゲーム本体に加える変更は3つだけです: ライブラリの読み込み先、MQTT の代役、
メインループ直前に置くテスト用フック `window.__t`。

## 構成

```
lab/core/rng.js            決定論的乱数。全ての確率的選択はここを通る
lab/core/connectome.js     Neuron / Synapse / Graph / Mock生成 / 指標      (§5–§7)
lab/core/compress.js       圧縮戦略5種と比較                               (§8)
lab/core/neural.js         Neural Core（漏れ積分・抑制・再帰・調節）       (§9, §10)
lab/core/worldstate.js     WorldState — ゲームとAIの境界。スキーマと正規化 (§12)
lab/core/sensors.js        Sensor Layer — 観測 → WorldState。信念を持つ     (§11, §17)
lab/core/fairness.js       反応遅延・先読みの閾値・連撃防止・難易度        (§17, §18)
lab/adapter/game_adapter.js  ゲーム本体を「読むだけ」の唯一の窓口          (§4 game_adapter)
lab/test/                  テスト                                          (§33)
lab/test/harness/          本物のゲームを動かすテスト基盤
lab/bench/                 性能と戦略の実測                                (§8, §28, §33)
```

### Phase 3 の境界（§11, §12, §17）

```
index.html の変数 ──▶ game_adapter ──▶ 観測(obs) ──▶ SensorLayer ──▶ WorldState ──▶ toChannels ──▶ NeuralCore
 (p, MP.peers,         読むだけ          見える/聞こえる    信念を持つ         生の単位(m, s)    0..1 へ
  rayCity, clearAt)    乱数を引かない     ものだけ          壁越しに追わない    36 項目
```

- **入力は読みません。** 観測に `keys` / `joystick` / `wantFire` などが入っていれば strict モードで例外、
  非 strict でも一切参照しません（テストで「入れても出力が1ビットも変わらない」ことを確認）。
- **見えないものは知りません。** 壁の向こうに消えたプレイヤーは、最後の速度で 1.2 秒だけ推測して止まります。
  銃声が聞こえれば、その付近（距離の6%程度の誤差）に信念を戻します。
- **§11 のうちこのゲームに無いもの**（スタミナ・防御・スキル状態・環境ハザード）は、
  定数で埋めずに `UNAVAILABLE` として理由付きで宣言しています。
- **光線は1ティックあたり上限つき**（注視中の相手1本＋他の相手に2本まで）。
  「近くに壁があるか」は光線ではなくゲームの足場判定 `clearAt` で答えます
  （`rayCity` は長さに関係なく街中の全建物を調べるため）。

## データについて (§27)

**FlyWire の実データはこのリポジトリに含まれていません。** Mock のみで全工程を進める方針です（D3）。
実データを導入する場合は、ライセンス・利用条件・再配布制限を確認したうえで `lab/data/` に置き、
`.gitignore` してください。`Graph` が契約なので、ローダーを差し替えるだけで下流は変わりません。

## 科学的な表現について (§26)

このプロジェクトは **connectome-inspired abstraction** です。
「ハエの脳と同じ」「ニューロンを完全再現」といった主張はしません。
`connectome.js` の機能クラス（SENSORY / MOTOR など）は**ゲーム側の抽象**であり、
生物学的事実の断定ではありません。

### Phase 4 の公平性（§17, §18）

難易度は **知能（mind）** と **体（body）** の2つに分かれています。ADAPTIVE（既定）が動かすのは知能だけです。

| | EASY | NORMAL | HARD | NIGHTMARE |
|---|---|---|---|---|
| 反応の遅れ | 0.45 s | 0.32 s | 0.22 s | 0.15 s |
| 先読みする確信度の下限 | 0.75 | 0.62 | 0.50 | 0.42 |
| 確信していても外す率 | 20% | 12% | 6% | 3% |
| 攻撃力 / 体力 | ×0.70 / ×0.75 | ×1 / ×1 | ×1.2 / ×1.25 | ×1.45 / ×1.6 |
| 当てた後に同じ相手を攻撃しない時間 | 1.4 s | 1.0 s | 0.75 s | 0.55 s |
| 6秒あたりの攻撃回数の上限 | 3 | 4 | 5 | 6 |

- どの難易度でも**予備動作は 0.40 秒未満になりません**。
- ADAPTIVE は EASY〜HARD の間を動きます（NIGHTMARE には自動で上がりません）。プレイヤーが一方的に勝っていれば読みが鋭くなり、
  倒され続けていれば鈍くなります。互角なら動きません。落ち着いた位置は保存されます（D4）。
