"""顧客台帳（data/customers.csv）の読み書きと、誕生日の判定。

■ 台帳の形
    name,birthday,last_visit,memo
    山田花子,1990-06-23,2026-07-12,転職と人間関係。9月が動く時期と伝えた

- `birthday` は原則 `YYYY-MM-DD`（LINEから登録するときに正規化される）。
  ただし手で直されることを前提に、読む側は `1990/6/23` `1990年6月23日` `6/23`（年なし）
  なども受ける。読めない行は黙って飛ばす（1行の書き損じで全体を止めない）。
- `last_visit` `memo` は任意。空でよい。

■ 個人情報
このCSVには顧客の氏名と生年月日が入る。**必ず private リポジトリに置くこと。**
ログやLINEの返信に台帳を丸ごと出さない（一覧は件数を絞って返す）。
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

JST = timezone(timedelta(hours=9))

CSV_HEADER = ["name", "birthday", "last_visit", "memo"]

# 表計算ソフトで開いたときに数式として実行されうる先頭文字
_FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


def today_jst() -> date:
    return datetime.now(JST).date()


# ---------------------------------------------------------------- 生年月日

@dataclass(frozen=True)
class Birthday:
    year: Optional[int]
    month: int
    day: int


def parse_birthday(value: str) -> Optional[Birthday]:
    """生年月日の文字列を Birthday にする。読めなければ None。

    `1990-06-23` `1990/6/23` `1990.6.23` `1990年6月23日` `19900623`
    `6/23`（年なし）と、それらの全角表記に対応する。
    """
    if not value:
        return None

    s = str(value).strip()
    if not s:
        return None

    # 全角 → 半角
    s = s.translate(str.maketrans("０１２３４５６７８９／－．　", "0123456789/-. "))
    s = s.replace("ー", "-").replace("−", "-").strip()

    m = re.fullmatch(r"(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?", s)
    if m:
        return _valid(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    m = re.fullmatch(r"(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?", s)
    if m:
        return _valid(None, int(m.group(1)), int(m.group(2)))

    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s)
    if m:
        return _valid(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    # 台帳に書かれる「年なし」の形（normalize_birthday の出力）
    m = re.fullmatch(r"--(\d{1,2})-(\d{1,2})", s)
    if m:
        return _valid(None, int(m.group(1)), int(m.group(2)))

    return None


def _valid(year: Optional[int], month: int, day: int) -> Optional[Birthday]:
    if not 1 <= month <= 12:
        return None
    if not 1 <= day <= 31:
        return None
    if year is not None and not 1900 <= year <= 2100:
        return None
    return Birthday(year, month, day)


def normalize_birthday(value: str) -> Optional[str]:
    """台帳に書く形（`YYYY-MM-DD` / 年なしは `--MM-DD`）に整える。"""
    bd = parse_birthday(value)
    if bd is None:
        return None
    if bd.year is None:
        return f"--{bd.month:02d}-{bd.day:02d}"
    return f"{bd.year:04d}-{bd.month:02d}-{bd.day:02d}"


def is_leap(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def is_birthday_on(bd: Birthday, target: date) -> bool:
    """その日が誕生日か。

    2月29日生まれは、うるう年でない年は2月28日を誕生日として扱う
    （3月1日にする流儀もあるが、「2月のうちに祝う」ほうが自然なのでこちら）。
    """
    if bd.month == target.month and bd.day == target.day:
        return True
    if (
        bd.month == 2
        and bd.day == 29
        and target.month == 2
        and target.day == 28
        and not is_leap(target.year)
    ):
        return True
    return False


def age_on(bd: Birthday, target: date) -> Optional[int]:
    """その日時点の満年齢。生年が分からなければ None。"""
    if bd.year is None:
        return None
    age = target.year - bd.year
    if (target.month, target.day) < (bd.month, bd.day):
        age -= 1
    return age


# ---------------------------------------------------------------- 台帳

@dataclass
class Customer:
    name: str
    birthday: str
    last_visit: str = ""
    memo: str = ""

    def parsed_birthday(self) -> Optional[Birthday]:
        return parse_birthday(self.birthday)


#: 正規化済みの日付（`1990-06-23` / 年なしの `--06-23`）
_NORMALIZED_DATE = re.compile(r"^(?:\d{4}-|--)\d{1,2}-\d{1,2}$")


def sanitize(value: str) -> str:
    """表計算ソフトで数式として実行されないようにする（CSVインジェクション対策）。

    台帳はスプレッドシートやExcelで開かれる可能性がある。`=HYPERLINK(...)` のような
    値をそのまま書くと、開いた人の環境で実行されうる。先頭に `'` を足して無害化する。

    ただし年なしの誕生日 `--06-23` は `-` で始まるため、そのままだと
    `'--06-23` に化けて読めなくなる。正規化済みの日付は素通しする。
    """
    s = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    if _NORMALIZED_DATE.match(s):
        return s
    if s.startswith(_FORMULA_PREFIX):
        s = "'" + s
    return s


def load(path: str | Path) -> list[Customer]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    out: list[Customer] = []
    for r in rows:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        out.append(
            Customer(
                name=name,
                birthday=(r.get("birthday") or "").strip(),
                last_visit=(r.get("last_visit") or "").strip(),
                memo=(r.get("memo") or "").strip(),
            )
        )
    return out


def dumps(customers: list[Customer]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_HEADER, lineterminator="\n")
    w.writeheader()
    for c in customers:
        w.writerow(
            {
                "name": sanitize(c.name),
                "birthday": sanitize(c.birthday),
                "last_visit": sanitize(c.last_visit),
                "memo": sanitize(c.memo),
            }
        )
    return buf.getvalue()


def save(path: str | Path, customers: list[Customer]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dumps(customers), encoding="utf-8")


# ---------------------------------------------------------------- 抽出

@dataclass
class Hit:
    customer: Customer
    age: Optional[int]
    offset: int          # 何日後が誕生日か（0＝今日）


def find_birthdays(
    customers: list[Customer],
    today: date,
    offsets: list[int],
) -> list[Hit]:
    """offsets で指定した日数後が誕生日の人を集める。offsets の順に並ぶ。"""
    hits: list[Hit] = []
    for off in sorted(set(offsets)):
        target = today + timedelta(days=off)
        for c in customers:
            bd = c.parsed_birthday()
            if bd is None:
                continue
            if not is_birthday_on(bd, target):
                continue
            hits.append(Hit(customer=c, age=age_on(bd, target), offset=off))
    return hits


def parse_offsets(raw: str) -> list[int]:
    """`0,3` のような指定を [0, 3] にする。読めなければ [0]。"""
    out: list[int] = []
    for part in re.split(r"[,、\s]+", str(raw or "")):
        if not part:
            continue
        try:
            n = int(part)
        except ValueError:
            continue
        if 0 <= n <= 60 and n not in out:
            out.append(n)
    return sorted(out) or [0]


def build_message(hits: list[Hit]) -> str:
    """LINEに送る本文を組み立てる。該当なしなら空文字。

    文面を変えたいときはここだけ直せばよい。
    """
    if not hits:
        return ""

    blocks: list[str] = []
    for off in sorted({h.offset for h in hits}):
        group = [h for h in hits if h.offset == off]
        head = (
            f"🎂 今日が誕生日（{len(group)}名）"
            if off == 0
            else f"📅 {off}日後が誕生日（{len(group)}名）"
        )
        lines = [head, ""]
        for h in group:
            title = f"・{h.customer.name}"
            if h.age is not None:
                title += f"（{h.age}歳）" if off == 0 else f"（{h.age}歳になります）"
            lines.append(title)

            sub = []
            if h.customer.last_visit:
                sub.append(f"前回 {h.customer.last_visit}")
            if h.customer.memo:
                sub.append(h.customer.memo)
            if sub:
                lines.append("　" + "｜".join(sub))
            lines.append("")
        blocks.append("\n".join(lines).rstrip())

    return "\n\n────────\n\n".join(blocks)
