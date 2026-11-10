#!/usr/bin/env python3
"""بررسی قرارداد API مینی‌اپ هدف. فقط کتابخانهٔ استاندارد.

API باید روی http://127.0.0.1:4000 بالا باشد.
این فایل را تغییر نده.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import date
from typing import Any

BASE = "http://127.0.0.1:4000"
failures = 0


def add_days(value: date, days: int) -> date:
    return date.fromordinal(value.toordinal() + days)


def request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode()
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers=req_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            raw = response.read().decode()
            parsed = json.loads(raw) if raw else None
            return response.status, parsed
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw
        return error.code, parsed


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    mark = "PASS" if ok else "FAIL"
    line = f"[{mark}] {name}"
    if detail:
        line = f"{line} — {detail}"
    print(line)
    if not ok:
        failures += 1


def expect_error(name: str, status: int, payload: Any, code: str, http_status: int) -> None:
    got_code = payload.get("code") if isinstance(payload, dict) else None
    ok = status == http_status and got_code == code
    check(
        name,
        ok,
        "" if ok else f"انتظار {http_status}/{code}، آمد {status}/{got_code}، بدنه {payload}",
    )


def goal_by_name(goals: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for goal in goals:
        if goal.get("name") == name:
            return goal
    return None


def main() -> int:
    try:
        status, payload = request("POST", "/api/reset", {})
    except urllib.error.URLError as error:
        print(f"API در {BASE} در دسترس نیست: {error.reason}")
        print("سرور را بالا بیاور و دوباره python3 check_api.py را اجرا کن.")
        return 1

    check("reset", status == 200 and isinstance(payload, dict) and payload.get("ok") is True, str(payload))

    status, wallet = request("GET", "/api/wallet")
    check(
        "موجودی اولیه",
        status == 200 and isinstance(wallet, dict) and wallet.get("availableAmount") == 25_000_000,
        str(wallet),
    )

    status, active = request("GET", "/api/goals?status=active")
    active_goals = active.get("goals") if isinstance(active, dict) else None
    names = {goal.get("name") for goal in active_goals} if isinstance(active_goals, list) else set()
    check(
        "سه هدف فعال",
        status == 200 and names == {"سفر شمال", "کتاب", "لپ‌تاپ"},
        str(names),
    )

    status, completed = request("GET", "/api/goals?status=completed")
    completed_goals = completed.get("goals") if isinstance(completed, dict) else None
    check(
        "تمام‌شده خالی است",
        status == 200 and completed_goals == [],
        str(completed),
    )

    status, payload = request(
        "POST",
        "/api/goals",
        {
            "name": "ا",
            "targetAmount": 10_000_000,
            "deadline": add_days(date.today(), 90).isoformat(),
            "fundingSource": "monthly",
            "acceptedTerms": True,
        },
    )
    expect_error("نام کوتاه رد می‌شود", status, payload, "VALIDATION", 400)

    status, payload = request(
        "POST",
        "/api/goals",
        {
            "name": "دوچرخه",
            "targetAmount": 10_000_000,
            "deadline": add_days(date.today(), 1).isoformat(),
            "fundingSource": "monthly",
            "acceptedTerms": True,
        },
    )
    expect_error("مهلت فردا رد می‌شود", status, payload, "VALIDATION", 400)

    deadline = add_days(date.today(), 90).isoformat()
    status, created = request(
        "POST",
        "/api/goals",
        {
            "name": "دوچرخه",
            "targetAmount": 10_000_000,
            "deadline": deadline,
            "fundingSource": "monthly",
            "acceptedTerms": True,
        },
    )
    created_goal = created.get("goal") if isinstance(created, dict) else None
    check(
        "ساخت هدف",
        status == 201
        and isinstance(created_goal, dict)
        and created_goal.get("name") == "دوچرخه"
        and created_goal.get("savedAmount") == 0
        and created_goal.get("status") == "active",
        str(created),
    )

    status, active = request("GET", "/api/goals?status=active")
    active_goals = active.get("goals") if isinstance(active, dict) else []
    book = goal_by_name(active_goals, "کتاب") if isinstance(active_goals, list) else None
    trip = goal_by_name(active_goals, "سفر شمال") if isinstance(active_goals, list) else None
    laptop = goal_by_name(active_goals, "لپ‌تاپ") if isinstance(active_goals, list) else None
    check("شناسهٔ کتاب و سفر و لپ‌تاپ", bool(book and trip and laptop), str(active_goals))
    if not book or not trip or not laptop:
        print(f"\n{failures} مورد رد شد. ادامه بدون شناسه ممکن نیست.")
        return 1

    status, payload = request(
        "POST",
        f"/api/goals/{book['id']}/deposits",
        {"amount": 600_000},
        {"Idempotency-Key": "book-over"},
    )
    expect_error("بیشتر از باقی‌ماندهٔ کتاب", status, payload, "OVER_TARGET", 422)
    status, wallet = request("GET", "/api/wallet")
    check(
        "موجودی بعد از over-target دست نخورده",
        isinstance(wallet, dict) and wallet.get("availableAmount") == 25_000_000,
        str(wallet),
    )

    status, deposited = request(
        "POST",
        f"/api/goals/{book['id']}/deposits",
        {"amount": 500_000},
        {"Idempotency-Key": "book-finish"},
    )
    deposited_goal = deposited.get("goal") if isinstance(deposited, dict) else None
    deposited_wallet = deposited.get("wallet") if isinstance(deposited, dict) else None
    check(
        "تکمیل کتاب",
        status == 200
        and isinstance(deposited_goal, dict)
        and deposited_goal.get("status") == "completed"
        and deposited_goal.get("savedAmount") == 2_000_000
        and isinstance(deposited_wallet, dict)
        and deposited_wallet.get("availableAmount") == 24_500_000,
        str(deposited),
    )

    status, replay = request(
        "POST",
        f"/api/goals/{book['id']}/deposits",
        {"amount": 500_000},
        {"Idempotency-Key": "book-finish"},
    )
    replay_wallet = replay.get("wallet") if isinstance(replay, dict) else None
    check(
        "تکرار همان کلید دوباره کم نمی‌کند",
        status == 200
        and isinstance(replay_wallet, dict)
        and replay_wallet.get("availableAmount") == 24_500_000,
        str(replay),
    )
    status, wallet = request("GET", "/api/wallet")
    check(
        "موجودی بعد از تکرار کلید",
        isinstance(wallet, dict) and wallet.get("availableAmount") == 24_500_000,
        str(wallet),
    )

    status, payload = request(
        "POST",
        f"/api/goals/{book['id']}/deposits",
        {"amount": 1_000},
        {"Idempotency-Key": "book-again"},
    )
    expect_error("واریز به هدف تمام‌شده", status, payload, "NOT_ALLOWED", 409)

    status, payload = request(
        "POST",
        f"/api/goals/{laptop['id']}/deposits",
        {"amount": 30_000_000},
        {"Idempotency-Key": "laptop-poor"},
    )
    expect_error("موجودی ناکافی", status, payload, "INSUFFICIENT_BALANCE", 422)
    status, wallet = request("GET", "/api/wallet")
    check(
        "موجودی بعد از موجودی ناکافی",
        isinstance(wallet, dict) and wallet.get("availableAmount") == 24_500_000,
        str(wallet),
    )

    status, payload = request(
        "POST",
        f"/api/goals/{laptop['id']}/deposits",
        {"amount": 1_000},
    )
    expect_error("واریز بدون کلید", status, payload, "MISSING_IDEMPOTENCY_KEY", 400)

    status, first = request(
        "POST",
        f"/api/goals/{laptop['id']}/deposits",
        {"amount": 1_000},
        {"Idempotency-Key": "laptop-1"},
    )
    first_wallet = first.get("wallet") if isinstance(first, dict) else None
    check(
        "واریز کوچک لپ‌تاپ",
        status == 200
        and isinstance(first_wallet, dict)
        and first_wallet.get("availableAmount") == 24_499_000,
        str(first),
    )

    status, payload = request(
        "POST",
        f"/api/goals/{laptop['id']}/deposits",
        {"amount": 2_000},
        {"Idempotency-Key": "laptop-1"},
    )
    expect_error("همان کلید با مبلغ دیگر", status, payload, "IDEMPOTENCY_CONFLICT", 409)
    status, wallet = request("GET", "/api/wallet")
    check(
        "موجودی بعد از تعارض کلید",
        isinstance(wallet, dict) and wallet.get("availableAmount") == 24_499_000,
        str(wallet),
    )

    status, cancelled = request("POST", f"/api/goals/{trip['id']}/cancel", {})
    cancelled_wallet = cancelled.get("wallet") if isinstance(cancelled, dict) else None
    check(
        "لغو سفر شمال",
        status == 200
        and isinstance(cancelled_wallet, dict)
        and cancelled_wallet.get("availableAmount") == 32_499_000,
        str(cancelled),
    )
    status, active = request("GET", "/api/goals?status=active")
    active_goals = active.get("goals") if isinstance(active, dict) else []
    still_there = goal_by_name(active_goals, "سفر شمال") if isinstance(active_goals, list) else None
    check("سفر شمال از لیست فعال حذف شده", still_there is None, str(active_goals))

    status, payload = request("POST", f"/api/goals/{book['id']}/cancel", {})
    expect_error("لغو هدف تمام‌شده", status, payload, "NOT_ALLOWED", 409)

    status, missing = request("GET", "/api/goals/does-not-exist")
    expect_error("هدف ناموجود", status, missing, "NOT_FOUND", 404)

    print()
    if failures:
        print(f"{failures} مورد رد شد.")
        return 1
    print("همهٔ بررسی‌های API سبز شد.")
    print("باقی‌ماندهٔ مرور دستی است: ری‌استارت پروسه، CORS، و UI.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
