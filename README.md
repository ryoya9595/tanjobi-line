# tanjobi-line（誕生日LINE通知）

お客様の誕生日を **LINEで登録** して、当日の朝に **LINEで受け取る**。
ココナラ等で鑑定した占い師向けに配布する前提のキット。

**解説ページ： https://ryoya9595.github.io/tanjobi-line/**

## 方針

- **狙いはリピート**。誕生日は連絡してもいやがられない数少ないきっかけ
- 通知先は**お客様ではなく本人**。自動配信はしない（手で一言送るための"気づき"を届ける）
- 通知には**年齢・前回からの間隔・前回のメモ**を出す。この3つで「何と声をかけるか」がその場で決まる
- **登録の入口もLINE**。鑑定直後にスマホで放り込めないと台帳は続かない
- 該当0名の日は送らない
- 既存のLINE公式アカウント（エルメ／Lステップ）には触らず、**通知専用アカウントを新規に作る**
- 構成は `message-checker` と揃える（GitHub Actions + Python + LINE push）

## 構成

```
スマホのLINE
   │ 「山田花子 1990/06/23 金運鑑定」
   ↓ Webhook（署名検証 + 本人のuserIdのみ）
Vercel  webhook/api/webhook.js
   ↓ GitHub Contents API
private repo  data/customers.csv
   ↑ 毎朝 GitHub Actions（.github/workflows/birthday.yml）
   ↓ scripts/birthday_check.py → scripts/notify.py
スマホのLINE に通知
```

| 読む順番 | ファイル | 誰が |
|---|---|---|
| 1 | `はじめにお読みください.md` | 人 |
| 2 | `事前準備ガイド.md` | 人（GitHub・LINE・Vercel の設定） |
| 3 | `導入手順_ClaudeCodeに読ませる.md` | Claude Code |
| — | `導入をサポートする人へ.md` | 設置してあげる人 |
| — | `kit/` | 相手のリポジトリ直下に置くもの |
| — | `webhook/` | Vercel に置くもの（Root Directory = `webhook`） |
| — | `dev/` | 検証（納品物ではない） |

## 開発

コードを直したら**必ず両方**：

```bash
python3 dev/test_logic.py      # 誕生日判定・台帳の読み書き・数式インジェクション対策
node dev/test_webhook.mjs      # LINEメッセージの解釈・CSV・JS↔Python の整合
```

`test_webhook.mjs` の最後は「JSが書いたCSVをPythonが同じに読めるか」を通しで確認している。
生年月日の表現は JS（`normalizeBirthday`）と Python（`parse_birthday`）の両方に実装があるため、
**片方だけ直すと「登録はできるのに通知が飛ばない」という壊れ方をする**。この検証を消さないこと。

配布用Zipを作り直す：

```bash
bash dev/build_zip.sh
```

## 仕様メモ

- **2月29日生まれ**は、平年は2月28日に通知
- **生年不明**は `--MM-DD` で保存し、年齢を出さない（`6/23` だけの登録に対応）
- CSVに書く値は**数式インジェクション対策**でエスケープする。ただし正規化済みの日付
  （`--06-23` は `-` 始まり）は素通しする
- LINEのWebhookは**署名検証 + `ALLOWED_USER_ID` の一致**の二段。他人のメッセージは黙って無視
- メッセージ本文はコマンド判定と台帳への記録にしか使わない（AIにも外部コマンドにも渡さない）
- 同名の登録は上書きせず、`更新` を付けたときだけ上書きする
- 削除の返信には復元用の1行が入る（実質のundo）

## 既知の制約

- GitHub Actions の `schedule` は混雑時に数十分ずれる。きっかりの時刻が必要なら、
  外部cron（Cloudflare Workers など）から `workflow_dispatch` を叩く方式に変える
  （`message-checker` の github-cron-trigger と同じやり方）
- GitHub の Fine-grained PAT には期限がある。切れると登録ができなくなる
- 台帳の一括編集はGitHub上かClaude Code経由（スマホからは1件ずつ）

## アーカイブ

`_archive_gas版/` に、最初に作ったGAS版（Googleスプレッドシート＋Apps Script）がある。
GitHub/Vercelを持ちたくない相手にはそちらが向く。単体で動く状態で残してある。
