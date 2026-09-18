# 【AIエージェントへの指示】誕生日LINE通知の導入

このファイルを読んだAI（Claude Code など）へ。**あなたが主導して**導入を進めてください。

担当者（人間）にやってもらうのは、原則として次の3つだけです。

1. **ログイン**（GitHub・LINE・Vercel）
2. **秘密の値の貼り付け**（トークン・シークレット・PAT）
3. **スマホでの操作**（QRコードでの友だち追加、動作確認のメッセージ送信）

それ以外——画面の遷移、ボタン操作、入力、ファイル配置、コマンド実行、台帳の整形——は、使えるツールの範囲で**あなたが行います**。

> ⚠️ **絶対に守ること**
>
> - **確認を取る前に、外部サービスの状態を変えない。** 各STEPの冒頭で「これから○○します。進めてよいですか？」と聞き、「はい」をもらってから進める（STEPの中の個々のクリックは、都度聞かなくてよい）
> - 🔴 **いま使っているLINE公式アカウント（エルメ／Lステップにつないでいるもの）には触らない。** 通知専用アカウントを**新規に作る**。既存チャネルの「チャネルアクセストークンの再発行」も「Webhook URLの変更」も、**相手の配信を壊す**
> - 🔴 **「再発行」ボタンは押さない。** 押してよいのは、新しく作ったチャネルの「**発行**」だけ
> - 🔴 **リポジトリは必ず Private で作る。** 顧客の氏名と生年月日が入る。Public で作ってしまったら、作り直す（Public にした時点で公開された前提で扱う）
> - **パスワード・2段階認証コードを入力しない。** ログイン画面が出たら担当者に交代し、終わったら再開する
> - **トークンを扱わない。** 画面に表示されたトークン・シークレット・PATを、チャットに書き出さない・ファイルに保存しない・コミットしない。貼り付けは担当者本人にやってもらう
> - **お客様の個人情報をチャットに展開しない。** 台帳やCSVを扱うときは、件数と列の構成だけを報告し、氏名・生年月日の一覧をチャットに出力しない
> - **既存のものを消さない。** `rm -rf` / `mv` を使わない。他のリポジトリ・プロジェクト・チャネルに触らない
> - **押す前に止まって聞くもの：** 削除・再発行・課金・リポジトリの公開設定の変更

> 💻 Mac / Windows 共通。コマンドはOSごとに書き分けてあります。

---

## STEP 0｜キットを手に入れる

**Zipが添付されている場合（通常はこちら）**：解凍して、中の `tanjobi-line/` がキット本体。以降「このキットのパス」＝ここ。

Zipが無い場合：

Mac / Linux
```
cd ~/Desktop && curl -sSL -o tanjobi-line-kit.zip https://ryoya9595.github.io/tanjobi-line/tanjobi-line-kit.zip && unzip -q tanjobi-line-kit.zip
```
Windows（PowerShell）
```
Set-Location "$HOME\Desktop"; Invoke-WebRequest -Uri https://ryoya9595.github.io/tanjobi-line/tanjobi-line-kit.zip -OutFile tanjobi-line-kit.zip; Expand-Archive tanjobi-line-kit.zip -DestinationPath .
```

## STEP 1｜全体像を説明し、確認を取る

担当者に伝える：

> お客様の誕生日を**LINEで登録して、当日の朝にLINEで受け取る**仕組みを作ります。狙いは、誕生日をきっかけにもう一度ご相談いただくことです。
> 鑑定のあとに「山田花子 1990/06/23 金運鑑定」とLINEに送るだけで台帳に入り、その方の誕生日の朝に、同じトーク画面へ年齢と前回のメモつきで届きます。
>
> **お客様に自動でメッセージが飛ぶことはありません。** 送る言葉はご自身で選んでいただく設計です。
>
> 使うのは GitHub・LINE・Vercel の3つで、いずれも無料枠で足ります。
> いま配信に使っている公式アカウント（エルメなど）には触りません。通知専用のアカウントを新しく作ります。既存のトークンやWebhookを変えると配信が止まるためです。
>
> お願いするのは、ログイン・トークンの貼り付け・スマホ操作だけです。所要は1時間〜1時間半ほどです。

> 「まず、お使いのPCとアカウントの状況を確認します。よろしいですか？（はい／いいえ）」

「はい」以外なら進めない。

## STEP 2｜自分に何ができるか確認する

次を確認して、結果を担当者に一言で伝える。

| 確認 | 方法 | 使えると何ができるか |
|---|---|---|
| **ブラウザ操作**（Claude in Chrome） | ツール一覧に `mcp__claude-in-chrome__*` があるか。deferred なら `ToolSearch` で `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__get_page_text` を読み込み、`tabs_context_mcp` を1回呼ぶ | GitHub・LINE・Vercel の画面を**あなたが操作**できる |
| `git` | `git --version` | リポジトリ操作 |
| `gh`（GitHub CLI） | `gh auth status` | リポジトリ作成・Secrets登録をコマンドでできる（**大幅に速い**） |
| `python3` | `python3 --version`（Windows は `python --version`） | 台帳の変換・検証 |
| `node` | `node --version` | Webhookの検証 |

**`gh` が使えるなら最優先で使う。** リポジトリ作成・push・Secrets登録が全部コマンドで済む。
未インストールなら、担当者に入れてよいか聞く（`brew install gh` / `winget install GitHub.cli`）。断られたらブラウザ操作に切り替える。

**ブラウザ操作が使えない場合**：`事前準備ガイド.md` の該当箇所を**1ステップずつ読み上げて案内**する形に切り替える（それでも導入は完了できる）。

ブラウザ操作のルール：
- 必ず新しいタブを作り、そのタブだけを操作する。担当者が開いているタブには触らない
- ログイン画面が出たら「ログインをお願いします。終わったら『できた』と言ってください」と伝えて待つ
- **トークンが表示されている画面を読み取らない。** 「画面に出ている文字列をコピーしてください」と伝えるだけにする

## STEP 3｜GitHub に非公開リポジトリを作り、キットを置く

> 「お客様の台帳を置く非公開リポジトリを作ります。進めてよいですか？」

🔴 **Private で作ること。** 顧客の氏名と生年月日が入る。

**`gh` が使える場合（推奨）**

```
mkdir -p ~/tanjobi-line && cd ~/tanjobi-line
cp -R "<このキットのパス>/kit/." .
git init -b main
git add -A && git commit -m "誕生日LINE通知を追加"
gh repo create tanjobi-line --private --source=. --push
```
（Windows は `Copy-Item -Recurse "<このキットのパス>\kit\*" .`）

**`gh` が無い場合**：ブラウザで https://github.com/new を開き、名前 `tanjobi-line`・**Private** で作成（ログインは担当者）。そのあと上と同じくローカルで `git init` → `git remote add origin ...` → push。

確認：`git ls-files` に次が含まれること。

```
.github/workflows/birthday.yml
scripts/birthday_check.py
scripts/customers.py
scripts/notify.py
data/customers.csv
requirements.txt
```

⚠️ `kit/` というフォルダごとではなく、**中身をリポジトリ直下に置く**（`scripts/` が直下に来る形）。

## STEP 4｜通知用のLINEを用意する（あなたが画面を進める）

> 「通知を受け取るLINE公式アカウントを新しく作ります。いま使っているアカウントには触りません。進めてよいですか？」

`事前準備ガイド.md` の STEP 2-1 〜 2-5 の順に進める。要点：

1. https://manager.line.biz/ でアカウント作成（名前は `誕生日メモ`）。ログインは担当者
2. **応答設定**：応答モード `Bot` ／ あいさつメッセージ **オフ** ／ 応答メッセージ 🔴**オフ** ／ Webhook 🔴**オン**
   - 応答メッセージをオフにしないと、コマンドの返事と定型文が二重に届く
3. 「設定 → Messaging API → Messaging APIを利用する」。**プロバイダーは新規作成**を勧める
4. https://developers.line.biz/console/ →（プロバイダー）→（チャネル）
   - 「Messaging API設定」→ チャネルアクセストークン（長期）の「**発行**」
     - 🔴 表示が「再発行」なら押さない。別チャネルを開いている
   - 「チャネル基本設定」→ **チャネルシークレット**（トークンとは別物。両方必要）
   - 「チャネル基本設定」の一番下 → **あなたのユーザーID**（`U`で始まる33文字ほど）
5. 「Messaging API設定」の**QRコード**を表示し、スマホで**友だち追加**してもらう
   - ⚠️ ここを飛ばすと通知が届かない。**「追加できました」の返事をもらってから次へ**

担当者には「トークン」「シークレット」「ユーザーID」の3つを一時保存してもらう。**あなたは値を見ない。**

## STEP 5｜GitHub の PAT を作る（あなたが画面を進める）

> 「Vercel から台帳を読み書きするための鍵を作ります。進めてよいですか？」

https://github.com/settings/personal-access-tokens/new （Fine-grained tokens）

| 項目 | 値 |
|---|---|
| Token name | `tanjobi-line` |
| Expiration | 担当者に選んでもらう（**期限切れで登録できなくなる**ことを必ず伝える） |
| Repository access | Only select repositories → STEP 3 のリポジトリ |
| Repository permissions | **Contents: Read and write** と **Actions: Read and write** の2つだけ |

生成後の文字列は**一度しか表示されない**。担当者にコピー・一時保存してもらう。

## STEP 6｜GitHub Secrets に登録

**`gh` が使える場合**：担当者にターミナルで直接入力してもらう（チャットに貼らせない）。

```
gh secret set LINE_CHANNEL_ACCESS_TOKEN --repo <owner>/tanjobi-line
gh secret set LINE_TO_USER_ID --repo <owner>/tanjobi-line
```
（実行すると値の入力を求められる。担当者が貼り付ける）

**ブラウザの場合**：Settings → Secrets and variables → Actions → New repository secret。
Name はあなたが入力し、Value だけ担当者に貼ってもらう。

（任意）事前通知が欲しい場合は「Variables」に `NOTIFY_DAYS_BEFORE` = `0,3` を登録。

## STEP 7｜Vercel にデプロイする（あなたが画面を進める）

> 「LINEからのメッセージを受け取る場所を用意します。進めてよいですか？」

1. https://vercel.com/signup → **GitHubアカウントでログイン**（ログインは担当者）
2. Add New → Project → STEP 3 のリポジトリを Import
3. 🔴 **Root Directory を `webhook` にする**（ここを間違えると動かない。最多のつまずき）
   - キットの `webhook/` をリポジトリに含めていない場合は、先に含めて push する
4. Framework Preset: **Other**
5. Environment Variables に5つ登録（Name はあなたが入力、Value は担当者が貼り付け）：

| Name | 中身 |
|---|---|
| `LINE_CHANNEL_SECRET` | STEP 4 のチャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | STEP 4 のトークン |
| `ALLOWED_USER_ID` | STEP 4 のユーザーID |
| `GITHUB_TOKEN` | STEP 5 のPAT |
| `GITHUB_REPO` | `<owner>/tanjobi-line` ← これはあなたが入力してよい |

6. Deploy → 完了したらURL（`https://〇〇.vercel.app`）を控える

## STEP 8｜LINE と Vercel をつなぐ

1. https://developers.line.biz/console/ →（チャネル）→「Messaging API設定」
2. **Webhook URL** に `https://〇〇.vercel.app/api/webhook` を入力 →「更新」
3. 「**検証**」を押して `成功` を確認
   - 失敗する場合：URLの末尾 `/api/webhook` の抜け、Vercelのデプロイ未完了、Root Directory の設定ミス
4. 「**Webhookの利用**」をオン

## STEP 9｜動作確認（担当者がスマホで送る）

担当者に、スマホのLINEで順に送ってもらう：

| 送る | 期待 |
|---|---|
| `使い方` | コマンド一覧が返る |
| `テスト太郎 1990/06/23 動作確認` | 「✅ 登録しました」 |
| `一覧` | テスト太郎が出る |

**通知そのものの確認**：今日の日付で1人登録してから `今日` と送る。

```
テスト花子 1985/<今日の月>/<今日の日> 通知テスト
```

1分ほどで「🎂 今日が誕生日（1名）」が届けば通し完了。
確認後、`削除 テスト太郎` `削除 テスト花子` で消してもらう。

**うまくいかないとき**：

| 症状 | 見るところ |
|---|---|
| 何も返ってこない | Vercel の Deployments → 最新 → Logs。`ALLOWED_USER_ID` 不一致なら「non-allowed user」が出る |
| 定型文が混ざる | LINE の応答設定で「応答メッセージ」がオン |
| 「GitHubに書き込めませんでした」 | PATの権限（Contents / Actions）と `GITHUB_REPO` の綴り |
| 通知だけ来ない | GitHub の Actions タブ。ログに原因が日本語で出る |

## STEP 10｜台帳に既存のお客様を入れる

> 「これまでのお客様の情報を台帳に入れます。手元にリストはありますか？」

**⚠️ 個人情報を扱います。氏名や生年月日の一覧を、チャットに出力しないこと。** 変換はファイル上で行い、報告は件数と列構成だけにする。

台帳 `data/customers.csv` の形：

```csv
name,birthday,last_visit,memo
山田 花子,1990-06-23,2026-07-12,金運鑑定
```

- `birthday` は `YYYY-MM-DD`。生まれ年が分からない場合は `--MM-DD`（例 `--06-23`）
- `last_visit` `memo` は空でよい

**CSV・スプレッドシートがある場合**（エルメの友だちリスト、ココナラの購入者メモなど）：

1. **あなたが**ヘッダー行だけを見て、氏名と誕生日にあたる列を特定する
2. 上の形に変換して `data/customers.csv` に追記する（既存行は消さない）
3. 変換後、検証する：
   ```
   python3 dev/test_logic.py     # キット同梱の検証（読み取りロジック）
   ```
   さらに件数を確認：
   ```
   python3 -c "import sys; sys.path.insert(0,'scripts'); import customers as db; rows=db.load('data/customers.csv'); print('登録', len(rows), '名 / 誕生日を読めた', sum(1 for r in rows if r.parsed_birthday()), '名')"
   ```
   **「読めた数」が「登録数」より少ない場合**、その行の書式がおかしい。件数だけ報告して、担当者に確認する
4. commit して push
5. 担当者にLINEで `一覧` と送ってもらい、反映を確認

**リストが無い場合**：これから鑑定のたびにLINEで登録する運用でよい。まず2〜3名だけ入れて動きを見てもらう。

## STEP 11｜完了を伝える

> 「導入できました。
>
> **登録**：鑑定のあとに、LINEで `山田花子 1990/06/23 金運鑑定` のように送ってください。
> **更新**：鑑定が終わったら `メモ 山田花子 金運鑑定。9月以降が動く時期と伝えた` と送ってください。前回の鑑定日が今日になります。
> 　メモは「**何を占ったか＋次に繋がる一言**」で書いておくと、誕生日のときに「あの件どうなりました？」と続きから入れます。
> **通知**：誕生日の朝に、年齢と前回のメモつきで届きます。該当する方がいない日は何も届きません。
>
> お客様へメッセージが自動で飛ぶことはないので、届いた通知を見てご自身の言葉で送ってください。
>
> 1つだけ覚えておいてください。**GitHubのアクセストークンには期限があります**（STEP 5 で設定したもの）。切れると登録ができなくなるので、期限の少し前にカレンダーへリマインドを入れておくのがおすすめです。」

最後に、`使い方` と送れば操作を思い出せることを伝える。

---

## 変更・停止（担当者に頼まれたら）

| 変えたいこと | どこ |
|---|---|
| 通知の時刻 | `.github/workflows/birthday.yml` の `cron`（UTC。日本時間 −9時間） |
| 何日前にも知らせるか | GitHub の Variables `NOTIFY_DAYS_BEFORE` |
| 通知の文面 | `scripts/customers.py` の `build_message` |
| LINEのコマンド | `webhook/api/webhook.js` の `handleText` と `USAGE` |
| 一時停止 | GitHub の Actions タブ →「誕生日チェック」→ Disable workflow |

**LINE公式アカウント・チャネル・リポジトリ・Vercelプロジェクトは、担当者から明確に「消して」と言われない限り消さない。**

## コードを直したとき

必ず両方を通してから push する：

```
python3 dev/test_logic.py      # 誕生日判定・台帳の読み書き
node dev/test_webhook.mjs      # LINEメッセージの解釈・CSV・JS↔Python の整合
```

`test_webhook.mjs` の最後は「**JSが書いたCSVをPythonが同じに読めるか**」を確かめている。
ここがズレると「登録はできるのに通知が飛ばない」という気づきにくい壊れ方をするので、**この検証を消さないこと**。
