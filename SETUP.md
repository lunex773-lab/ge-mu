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

Cloudflare のダッシュボードで **Workers & Pages** を開くと、画面の右側に **Account ID** が表示されています。コピーして控えてください。
（見つからない場合は、ダッシュボード右上のアカウントメニュー → **Account Home** → アカウント名の横の「⋯」→ **Copy account ID**。）

### 1-2. API トークンを作る

1. ダッシュボード右上の人のアイコン → **My Profile** → 左の **API Tokens**
   （または **Manage Account → Account API Tokens**）を開きます。
2. **Create Token** を押します。
3. テンプレートの一覧から **Edit Cloudflare Workers** の **Use template** を押します。
4. **Account Resources** で自分のアカウントを選びます。**Zone Resources** は **All zones** のままで構いません。
5. **Continue to summary** → **Create Token** を押します。
6. 表示されたトークンを**コピーします。この画面でしか表示されません。**
   このトークンは他人に見せないでください（あなたのアカウントに公開する権限があります）。

### 1-3. GitHub にシークレットとして登録する

1. GitHub で `lunex773-lab/ge-mu` を開き、**Settings** → 左の **Secrets and variables** → **Actions** を開きます。
2. **New repository secret** で次の2つを登録します。

| Name | Secret |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1-2 でコピーしたトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 1-1 で控えた Account ID |

### 1-4. 公開する

- GitHub の **Actions** タブ → **Deploy to Cloudflare** → **Run workflow**（ブランチは `claude/multiplayer-login-c9n7dk`）→ 緑の **Run workflow** を押します。
- 1〜2分で完了します。ログの最後の方に `https://contour.<サブドメイン>.workers.dev` が出ます。
- **以後は、このブランチに push されるたびに自動で公開されます**（毎回、サーバーのテストを通ってから公開します）。
  自動にしたくない場合は教えてください。手動だけに変えます。

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
3. **性能の数字**: URL の最後に `?debug` を付けて開くと（例: `https://contour.xxx.workers.dev/?debug`）、左下にフレーム時間・JS 時間・通信量などが出ます。
   Phase 17（実機テスト）で、この数字をスクリーンショットで送ってください。

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
