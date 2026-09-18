#!/bin/bash
# 配布用Zipを作り直す。dev/ と _archive_gas版/ は含めない（納品物ではないため）。
#
# ⚠️ zip コマンドは使わない。macOS の zip は日本語ファイル名に UTF-8 フラグを立てないため、
#    Windows のエクスプローラーで解凍すると文字化けする。Python の zipfile なら自動で立つ。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ 検証"
python3 dev/test_logic.py > /dev/null || { echo "❌ Python側のテストが通らないのでZipを作りません"; exit 1; }
node dev/test_webhook.mjs > /dev/null || { echo "❌ JS側のテストが通らないのでZipを作りません"; exit 1; }
echo "  両方OK"

python3 - << 'PY'
import os, zipfile

NAME = 'tanjobi-line'
OUT = f'{NAME}-kit.zip'

DOCS = [
    'はじめにお読みください.md',
    '事前準備ガイド.md',
    '導入手順_ClaudeCodeに読ませる.md',
    '導入をサポートする人へ.md',
    # 相手のClaude Codeが文面を直したときに壊れていないか確かめられるよう同梱する
    'dev/test_logic.py',
    'dev/test_webhook.mjs',
]
TREES = ['kit', 'webhook']
SKIP_DIRS = {'node_modules', '.vercel', '.git', '__pycache__'}
SKIP_FILES = {'.DS_Store'}

files = list(DOCS)
for tree in TREES:
    for root, dirs, names in os.walk(tree):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in sorted(names):
            if n in SKIP_FILES:
                continue
            files.append(os.path.join(root, n))

missing = [f for f in files if not os.path.exists(f)]
if missing:
    raise SystemExit('❌ 見つからないファイル: ' + ', '.join(missing))

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f'{NAME}/{f}')

with zipfile.ZipFile(OUT) as z:
    bad = [i.filename for i in z.infolist()
           if not i.filename.isascii() and not (i.flag_bits & 0x800)]
    if bad:
        raise SystemExit('❌ UTF-8フラグが立っていません（Windowsで文字化けします）: ' + ', '.join(bad))
    print(f'\n✅ {OUT}  （{len(z.infolist())}ファイル / {os.path.getsize(OUT):,} バイト）')
    for i in z.infolist():
        print(f'   {i.file_size:>7,}  {i.filename}')
PY
