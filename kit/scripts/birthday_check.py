"""今日が誕生日のお客様を、自分のLINEに通知する。

毎朝 GitHub Actions から呼ばれる。該当する人がいない日は**何も送らない**
（毎日届くと見なくなるため）。

■ 使う環境変数
    LINE_CHANNEL_ACCESS_TOKEN   … 通知用LINE公式アカウントのトークン（Secrets）
    LINE_TO_USER_ID             … 自分のユーザーID（Secrets）
    NOTIFY_DAYS_BEFORE          … 任意。`0`＝当日のみ（既定）。`0,3` なら3日前にも

■ 動作確認
    python3 scripts/birthday_check.py --dry-run              … 送らずに中身だけ見る
    python3 scripts/birthday_check.py --date 2026-06-23      … その日で判定する
    python3 scripts/birthday_check.py --dry-run --date 06-23 … 組み合わせもできる

設定ミス・送信失敗は**終了コード1**で返す（Actions を赤くして気づけるように）。
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import customers as db  # noqa: E402
import notify  # noqa: E402

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "customers.csv"


def parse_date_arg(value: str) -> date:
    """`2026-06-23` と `06-23`（今年）の両方を受ける。"""
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    for fmt in ("%m-%d", "%m/%d"):
        try:
            d = datetime.strptime(value, fmt).date()
            return d.replace(year=db.today_jst().year)
        except ValueError:
            pass
    raise argparse.ArgumentTypeError(
        f"日付として読めません: {value}（例: 2026-06-23 または 06-23）"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="今日が誕生日のお客様をLINEに通知する")
    ap.add_argument("--date", type=parse_date_arg, help="この日で判定する（試すとき用）")
    ap.add_argument("--dry-run", action="store_true", help="送らずに中身だけ表示する")
    args = ap.parse_args()

    today = args.date or db.today_jst()
    offsets = db.parse_offsets(os.environ.get("NOTIFY_DAYS_BEFORE", "0"))

    if not CSV_PATH.exists():
        print(f"⚠️ 台帳が見つかりません: {CSV_PATH}")
        print("　 data/customers.csv を作ってください（ヘッダーだけでも動きます）")
        return 1

    people = db.load(CSV_PATH)
    hits = db.find_birthdays(people, today, offsets)

    # ログには件数だけ出す（個人情報を Actions のログに残さない）
    print(f"[誕生日] {today} 判定 / 台帳 {len(people)}名 / 該当 {len(hits)}名 / 対象日 {offsets}")

    text = db.build_message(hits)

    if not text:
        print("該当なし。何も送りません。")
        return 0

    if args.dry_run:
        print("--- 送られる内容 ---")
        print(text)
        print("--------------------")
        return 0

    ok, message = notify.push(text)
    print(message)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
