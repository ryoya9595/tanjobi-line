"""LINE Messaging API で自分に通知を送る。

`message-checker/notifier.py` と同じ作法：
- 1通の上限を超える本文は**行単位で**分割する（単語の途中で切らない）
- 1リクエストにつき最大5通まで
- 失敗したら理由を日本語で返す（呼び出し側がそのままログに出せるように）
"""

from __future__ import annotations

import os

import requests

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_INFO_URL = "https://api.line.me/v2/bot/info"

MAX_CHARS_PER_MESSAGE = 4500
MAX_MESSAGES_PER_REQUEST = 5

TOKEN_ENV = "LINE_CHANNEL_ACCESS_TOKEN"
USER_ID_ENV = "LINE_TO_USER_ID"


def split_text(text: str, max_chars: int = MAX_CHARS_PER_MESSAGE) -> list[str]:
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    current = ""
    for line in text.split("\n"):
        piece = line + "\n"
        if len(piece) > max_chars:
            if current:
                chunks.append(current.rstrip())
                current = ""
            for i in range(0, len(piece), max_chars):
                chunks.append(piece[i : i + max_chars].rstrip())
            continue
        if len(current) + len(piece) > max_chars:
            chunks.append(current.rstrip())
            current = piece
        else:
            current += piece
    if current.strip():
        chunks.append(current.rstrip())
    return chunks


def describe_error(status: int, body: str) -> str:
    """LINEのエラーを、原因の見当がつく日本語にする。"""
    if status == 401:
        return (
            "LINEに拒否されました（401）。トークンが違うか無効です。\n"
            f"GitHub Secrets の {TOKEN_ENV} を、LINE Developers の"
            "「チャネルアクセストークン（長期）」で入れ直してください。"
        )
    if status == 400:
        return (
            "LINEに拒否されました（400）。原因はほぼ次の2つです。\n"
            f"・{USER_ID_ENV} が違う（`U` で始まる33文字ほど。"
            "そのチャネルの「チャネル基本設定」にある「あなたのユーザーID」）\n"
            "・その公式アカウントを、自分のLINEで友だち追加していない\n"
            f"詳細: {body[:200]}"
        )
    if status == 429:
        return (
            "今月の無料メッセージ数を使い切った可能性があります（429）。\n"
            "LINE Official Account Manager で残数を確認してください。"
        )
    return f"LINEへの送信に失敗しました（{status}）。詳細: {body[:200]}"


def check_config() -> list[str]:
    """設定の問題を具体的な文言で返す。問題なしなら空リスト。"""
    problems: list[str] = []

    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        problems.append(f"{TOKEN_ENV} が未設定です（GitHub Secrets に登録してください）")
    elif len(token) < 50:
        problems.append(
            f"{TOKEN_ENV} が短すぎます（{len(token)}文字）。"
            "コピーが途中で切れている可能性があります"
        )

    user_id = os.environ.get(USER_ID_ENV, "").strip()
    if not user_id:
        problems.append(f"{USER_ID_ENV} が未設定です（GitHub Secrets に登録してください）")
    elif not user_id.startswith("U") or len(user_id) < 30:
        problems.append(
            f"{USER_ID_ENV} の形が違います。`U` で始まる33文字ほどの文字列です"
            "（チャネルIDやLINE IDとは別物）"
        )

    return problems


def verify_token() -> tuple[bool, str]:
    """トークンが生きているかだけ確かめる（メッセージは送らない）。"""
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        return False, f"{TOKEN_ENV} が未設定です"
    try:
        res = requests.get(
            LINE_INFO_URL, headers={"Authorization": f"Bearer {token}"}, timeout=20
        )
    except Exception as e:  # noqa: BLE001
        return False, f"LINEに接続できませんでした: {e}"

    if res.status_code == 200:
        name = ""
        try:
            name = res.json().get("displayName", "")
        except Exception:  # noqa: BLE001
            pass
        return True, f"トークンは有効です{f'（{name}）' if name else ''}"
    return False, describe_error(res.status_code, res.text)


def push(text: str) -> tuple[bool, str]:
    """自分あてに送る。(成功したか, 説明) を返す。"""
    problems = check_config()
    if problems:
        return False, "設定に問題があります:\n- " + "\n- ".join(problems)

    token = os.environ[TOKEN_ENV].strip()
    user_id = os.environ[USER_ID_ENV].strip()

    chunks = split_text(text)[:MAX_MESSAGES_PER_REQUEST]
    messages = [{"type": "text", "text": c} for c in chunks]

    try:
        res = requests.post(
            LINE_PUSH_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"to": user_id, "messages": messages},
            timeout=30,
        )
    except Exception as e:  # noqa: BLE001
        return False, f"LINEに接続できませんでした: {e}"

    if res.status_code == 200:
        return True, f"{len(messages)}通を送信しました"
    return False, describe_error(res.status_code, res.text)


if __name__ == "__main__":
    # 疎通確認:
    #   python3 scripts/notify.py            → トークンが生きているかだけ見る（送らない）
    #   python3 scripts/notify.py --send     → テスト通知を1通送る
    import sys

    if "--send" in sys.argv:
        ok, msg = push("🎂 接続テストです。\n\nこれが届いていれば設定は完了しています。")
    else:
        ok, msg = verify_token()

    print(msg)
    sys.exit(0 if ok else 1)
