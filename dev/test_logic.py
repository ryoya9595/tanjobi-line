"""台帳と誕生日判定の検証（納品物ではない）。

    python3 dev/test_logic.py

kit/scripts/ を直したら必ず実行する。LINEにもGitHubにも接続しない。
"""

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Zipを解いた直後は kit/scripts/、リポジトリに配置したあとは scripts/ にある
SCRIPTS = ROOT / "kit" / "scripts"
if not SCRIPTS.exists():
    SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import customers as db  # noqa: E402

NG = 0


def ok(label, actual, expected):
    global NG
    if actual == expected:
        print(f"  ok   {label}")
    else:
        NG += 1
        print(f"  NG   {label}\n       期待 {expected!r}\n       実際 {actual!r}")


print("\n■ 生年月日の読み取り")
B = db.Birthday
ok("1990-06-23", db.parse_birthday("1990-06-23"), B(1990, 6, 23))
ok("1990/6/23", db.parse_birthday("1990/6/23"), B(1990, 6, 23))
ok("1990.6.23", db.parse_birthday("1990.6.23"), B(1990, 6, 23))
ok("1990年6月23日", db.parse_birthday("1990年6月23日"), B(1990, 6, 23))
ok("19900623", db.parse_birthday("19900623"), B(1990, 6, 23))
ok("全角１９９０／６／２３", db.parse_birthday("１９９０／６／２３"), B(1990, 6, 23))
ok("年なし 6/23", db.parse_birthday("6/23"), B(None, 6, 23))
ok("年なし --06-23", db.parse_birthday("--06-23"), B(None, 6, 23))
ok("前後の空白", db.parse_birthday("  1990-06-23 "), B(1990, 6, 23))
ok("空はNone", db.parse_birthday(""), None)
ok("読めないのはNone", db.parse_birthday("なし"), None)
ok("13月はNone", db.parse_birthday("1990-13-01"), None)
ok("1800年はNone", db.parse_birthday("1800-06-23"), None)

print("\n■ 台帳に書く形への正規化")
ok("1990/6/23", db.normalize_birthday("1990/6/23"), "1990-06-23")
ok("年なし", db.normalize_birthday("6/23"), "--06-23")
ok("読めない", db.normalize_birthday("あした"), None)

print("\n■ 当日判定")
bd = B(1990, 6, 23)
ok("当日", db.is_birthday_on(bd, date(2026, 6, 23)), True)
ok("前日", db.is_birthday_on(bd, date(2026, 6, 22)), False)
ok("翌日", db.is_birthday_on(bd, date(2026, 6, 24)), False)
ok("月違い", db.is_birthday_on(bd, date(2026, 7, 23)), False)

print("\n■ 2月29日生まれ")
leap = B(1996, 2, 29)
ok("うるう年は2/29", db.is_birthday_on(leap, date(2028, 2, 29)), True)
ok("平年は2/28に繰り上げ", db.is_birthday_on(leap, date(2026, 2, 28)), True)
ok("うるう年の2/28は違う", db.is_birthday_on(leap, date(2028, 2, 28)), False)
ok("平年の3/1は違う", db.is_birthday_on(leap, date(2026, 3, 1)), False)
ok("2100年は平年", db.is_birthday_on(leap, date(2100, 2, 28)), True)
ok("2000年はうるう年", db.is_birthday_on(leap, date(2000, 2, 28)), False)

print("\n■ 年齢")
ok("誕生日当日", db.age_on(bd, date(2026, 6, 23)), 36)
ok("前日", db.age_on(bd, date(2026, 6, 22)), 35)
ok("翌日", db.age_on(bd, date(2026, 6, 24)), 36)
ok("年始", db.age_on(bd, date(2026, 1, 1)), 35)
ok("生年不明はNone", db.age_on(B(None, 6, 23), date(2026, 6, 23)), None)

print("\n■ CSVの読み書き")
rows = [
    db.Customer("山田 花子", "1990-06-23", "2026-07-12", "金運鑑定"),
    db.Customer("佐藤,あかり", "--02-29", "", 'メモに"引用"とカンマ,あり'),
]
text = db.dumps(rows)
tmp = ROOT / "dev" / "_tmp_test.csv"
tmp.write_text(text, encoding="utf-8")
back = db.load(tmp)
ok("往復で件数が合う", len(back), 2)
ok("カンマ入りの名前", back[1].name, "佐藤,あかり")
ok("引用符とカンマ入りのメモ", back[1].memo, 'メモに"引用"とカンマ,あり')
ok("年なしの誕生日", back[1].birthday, "--02-29")
tmp.unlink()

print("\n■ 数式インジェクション対策")
ok("= 始まり", db.sanitize("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")")
ok("+ 始まり", db.sanitize("+1+1"), "'+1+1")
ok("@ 始まり", db.sanitize("@SUM(A1)"), "'@SUM(A1)")
ok("ふつうの文字はそのまま", db.sanitize("転職の相談"), "転職の相談")
ok("改行は潰す", db.sanitize("1行目\n2行目"), "1行目 2行目")

print("\n■ 事前通知の指定")
ok("既定は当日のみ", db.parse_offsets("0"), [0])
ok("空なら当日のみ", db.parse_offsets(""), [0])
ok("カンマ区切り", db.parse_offsets("0,3"), [0, 3])
ok("順不同でも整列", db.parse_offsets("7, 0 ,3"), [0, 3, 7])
ok("変な値は無視", db.parse_offsets("0,abc,999"), [0])

print("\n■ 前回からの間隔（リピート判断の材料）")
ok("今月", db.months_since("2026-06-10", date(2026, 6, 23)), "今月")
ok("1ヶ月前", db.months_since("2026-05-10", date(2026, 6, 23)), "1ヶ月前")
ok("4ヶ月前", db.months_since("2026-02-23", date(2026, 6, 23)), "4ヶ月前")
ok("11ヶ月前", db.months_since("2025-07-23", date(2026, 6, 23)), "11ヶ月前")
ok("ちょうど1年前", db.months_since("2025-06-23", date(2026, 6, 23)), "1年前")
ok("1年2ヶ月前", db.months_since("2025-04-23", date(2026, 6, 23)), "1年2ヶ月前")
ok("3年前", db.months_since("2023-06-23", date(2026, 6, 23)), "3年前")
ok("日をまたぐ手前", db.months_since("2026-05-25", date(2026, 6, 23)), "今月")
ok("空欄はNone", db.months_since("", date(2026, 6, 23)), None)
ok("年なしはNone", db.months_since("--06-23", date(2026, 6, 23)), None)
ok("未来の日付はNone", db.months_since("2027-01-01", date(2026, 6, 23)), None)

print("\n■ 抽出と文面")
people = [
    db.Customer("山田 花子", "1990-06-23", "2025-07-12", "金運鑑定。9月以降が動く時期と伝えた"),
    db.Customer("佐藤 あかり", "--06-23", "", ""),
    db.Customer("田中 一郎", "1997-06-26", "2026-01-05", "恋愛。年内に判断したいとのこと"),
    db.Customer("読めない人", "あした", "", ""),
]
hits = db.find_birthdays(people, date(2026, 6, 23), [0, 3])
ok("当日2名＋3日後1名", len(hits), 3)
ok("読めない行は飛ばす", all(h.customer.name != "読めない人" for h in hits), True)

text = db.build_message(hits)
print("--- 実際に届く見た目 ---")
print(text)
print("------------------------")
ok("当日の見出し", "🎂 今日が誕生日（2名）" in text, True)
ok("3日後の見出し", "📅 3日後が誕生日（1名）" in text, True)
ok("年齢つき", "・山田 花子（36歳）" in text, True)
ok("生年不明は年齢なし", "・佐藤 あかり\n" in text or text.endswith("・佐藤 あかり"), True)
ok("事前は「になります」", "・田中 一郎（29歳になります）" in text, True)
ok("前回・間隔・メモ", "　前回 2025-07-12（11ヶ月前）｜金運鑑定。9月以降が動く時期と伝えた" in text, True)
ok("該当0なら空", db.build_message([]), "")

print("\n■ 長文の分割")
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("notify_nodeps", SCRIPTS / "notify.py")
try:
    notify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(notify)
    long_text = "\n".join(f"・テスト太郎{i}さん（30歳）" for i in range(400))
    chunks = notify.split_text(long_text, 4500)
    ok("分割される", len(chunks) > 1, True)
    ok("各チャンクが上限内", all(len(c) <= 4500 for c in chunks), True)
    ok("短ければ1つ", len(notify.split_text("みじかい", 4500)), 1)
except ModuleNotFoundError as e:
    print(f"  --   requests 未導入のため notify.py の検証はスキップ（{e.name}）")

print("\n✅ すべて通りました\n" if NG == 0 else f"\n❌ {NG}件 失敗しています\n")
sys.exit(0 if NG == 0 else 1)
