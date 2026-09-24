# Cloudflare のセットアップ手順

CONTOUR を Cloudflare で動かすための手順です。**ゲーム本体（index.html）とルームサーバーを1つの Worker として公開します。**
URL は `https://contour.<あなたのサブドメイン>.workers.dev` になります。

やり方は2つあります。**どちらか一方で十分です。**

- **方法1: GitHub だけで行う（おすすめ）** — パソコンが無くても、スマホのブラウザで設定できます。以後は私が push するたびに自動で公開されます。
- **方法2: パソコンから行う** — Node.js が入ったパソコンがある場合。

---

## 共通: Cloudflare のアカウントを作る

1. <https://dash.cloudflare.com/sign-up> を開き、メールアドレスとパスワードで登録します（メールの確認リンクを開きます）。
2. プランは **Free（無料）のまま**で始められます。このゲームが使う Durable Objects は Free でも使えます（料金と上限は下にあります）。
3. ダッシュボードの左のメニューから **Workers & Pages** を一度開いてください。
   初回は **workers.dev のサブドメイン**（例: `lunex773`）を決める画面が出ることがあります。好きな名前を決めてください。これが URL の一部になります。

---

## 方法1: GitHub だけで行う

### 1-1. アカウント ID を控える

1. Cloudflare のダッシュボード（<https://dash.cloudflare.com>）にログインします。
2. 左のメニューの **Workers & Pages** を開きます（**Compute** の中にあることもあります）。
3. 画面の **Account Details** の欄に **Account ID** があります。横のコピーボタンでコピーし、メモ帳などに貼っておきます。
   - 見つからないときは、画面上部の検索（パソコンなら `Ctrl + K`）に `Copy account ID` と入力して選ぶと、コピーされます。
   - Account ID は英数字32文字です（例: `0123456789abcdef0123456789abcdef`）。
4. 同じ画面に **Your subdomain**（`xxxx.workers.dev`）が出ていれば、それがあなたのサブドメインです。
   **サブドメインを決める画面が出た場合は、ここで決めてください。** 決まっていないと、最初の公開が失敗します。

### 1-2. API トークンを作る

1. <https://dash.cloudflare.com/profile/api-tokens> を開きます（右上の人のアイコン → **My Profile** → **API Tokens** と同じ場所）。
2. **Create Token** を押します。
3. テンプレートの一覧から **Edit Cloudflare Workers** の行の **Use template** を押します。
4. **Account Resources**: `Include` と、自分のアカウント名を選びます。
5. **Zone Resources**: `Include` と `All zones` のままで構いません（独自ドメインを持っていなくても大丈夫です）。
6. 下の **Continue to summary** → 次の画面で **Create Token** を押します。
7. 表示されたトークン（`cfut_` で始まる長い文字列）を**コピーします。この画面でしか表示されません。**
   閉じてしまったら、同じ手順でもう一度作り直せば大丈夫です。
   - **このトークンは誰にも見せないでください**（私にも送らないでください）。GitHub のシークレットに入れるだけで使えます。

### 1-3. GitHub にシークレットとして登録する

GitHub のスマホアプリでは設定できないので、**ブラウザ**（Safari や Chrome）で行います。

1. <https://github.com/lunex773-lab/ge-mu/settings/secrets/actions> を開きます
   （リポジトリの **Settings** → 左のメニューの **Secrets and variables** → **Actions** と同じ場所。
   スマホで Settings のタブが見えないときは、ブラウザのメニューから「デスクトップ用サイトを表示」にすると出ます）。
2. **New repository secret** を押し、次の1つ目を入れて **Add secret** を押します。

| Name（名前） | Secret（値） |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1-2 でコピーしたトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 1-1 で控えた Account ID |

3. もう一度 **New repository secret** を押して、2つ目も同じように登録します。
   名前は**大文字・アンダースコアまでこの通りに**入れてください（1文字でも違うと使われません）。
4. 一覧に2つとも並べば完了です（値は二度と表示されませんが、それで正常です）。

### 1-4. 公開する

次のどちらかで公開されます。

- **私に「登録した」と伝える**: 私がこのブランチに push すると、自動で公開されます（一番簡単です）。
- **自分で今すぐ公開する**: <https://github.com/lunex773-lab/ge-mu/actions> → 左の **Deploy to Cloudflare** →
  一番上の実行（run）を開く → 右上の **Re-run jobs** → **Re-run all jobs**。
  （**Run workflow** ボタンは、この仕組みが既定のブランチ `main` に入るまでは表示されません。）

2〜3分で終わります。実行（run）のページの下の方（Summary）に **公開先: `https://contour.<サブドメイン>.workers.dev`** と出ます。
ダッシュボードの **Workers & Pages** → **contour** からも確認できます。
**以後は、このブランチに push されるたびに自動で公開されます。** 毎回、サーバーのテストを通ってから公開し、
公開したあとに **Check the live site** の段で、本番のサイトが今のコードと同じか、ルームが正しく判定しているかを確かめます
（本番に作る確認用のルームは `_check-` で始まる名前なので、遊んでいる人のルームには入りません）。

---

## 方法2: パソコンから行う

1. **Node.js 20 以降**（<https://nodejs.org> の LTS 版）をインストールします。
2. ターミナル（Windows は「コマンドプロンプト」か PowerShell）で:

```sh
git clone https://github.com/lunex773-lab/ge-mu.git
cd ge-mu
git checkout claude/multiplayer-login-c9n7dk
npm install
npx wrangler login        # ブラウザが開くので「Allow」を押す
npx wrangler deploy       # 公開。最後に URL が表示されます
```

更新するときは `git pull` のあと `npx wrangler deploy` をもう一度実行します。

手元で試すだけなら `npx wrangler dev` で `http://localhost:8787` に同じものが立ち上がります（Cloudflare のアカウントは不要）。

---

## 動いているかの確認

1. 公開された URL をスマホで開き、名前とルームを入れて始めます。画面上部に **ONLINE · 1** と出れば、サーバーにつながっています。
2. 別のスマホ（またはパソコン）で**同じルーム名**で入ると **ONLINE · 2** になり、お互いが見えます。
3. **性能の数字**（Phase 17 の実機テスト）: URL の最後に `?debug` を付けて開くと（例: `https://contour.xxx.workers.dev/?debug`）、左下に数字が出ます。
   - 見てほしい行: `FPS`（と frame / worst）、`JS`（logic と draw）、`DRAW`（ドローコールと三角形）、`MEM`、`NET`
   - 1分ほど普通に歩き回ってから、**横持ち**と**縦持ち**でそれぞれスクリーンショットを撮ってください
     （iPhone: 電源ボタン＋音量を上げるボタン / Android: 電源ボタン＋音量を下げるボタン）
   - できれば、機種名（例: iPhone 13、Pixel 7）も教えてください
   - 数字は0.25秒ごとに変わります。撮るたびに違っていて構いません

GitHub Pages など、Cloudflare 以外に置いたコピーは、これまでどおり公開 MQTT ブローカーでつながります（移行が終わったら外します）。

---

## 料金と上限（2026-09-23 に公式ドキュメントで確認）

| | 内容 |
|---|---|
| ゲーム本体（静的ファイル） | **無料・無制限** |
| ルームサーバー（Durable Objects, Free） | 1日 **10万リクエスト**（受信メッセージは **20通で1回**と数える）、稼働時間 **13,000 GB-s/日**（約29ルーム時間） |
| 目安 | 4人で1日2時間遊んでも Free の範囲内の見込み |
| 上限を超えたら | その日（日本時間の朝9時＝UTC 0時まで）はサーバーにつながらず、ゲームは**一人プレイで続きます** |
| Paid（月 $5〜） | サーバー側で敵のAIを動かす段階（B5）で、Free の「1回の処理あたり CPU 10 ms」の制限に当たるようなら検討します。その時に相談します |

---

## 困ったとき

- **523 エラー**: 初めて公開した直後は数分出ることがあります。待つと直ります。
- **ONLINE にならない**: URL が `workers.dev` のものか確認してください。GitHub Pages の URL だと MQTT 経由になります。
- **サーバーのログを見たい**: 方法2の環境で `npx wrangler tail`、またはダッシュボードの Workers & Pages → contour → **Logs**。
- **GitHub Actions が失敗した**: Actions タブのログを、私に見せてください。
