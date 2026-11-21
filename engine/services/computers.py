"""Which computers do the background work (T3).

SecurePhotos lives on an external drive and is used on several computers. The first time the
library is opened on a computer it doesn't know, the app asks once whether to do the background
work there (enhancing to 8K, fixing old prints, preparing videos):

- "Yes, and remember this computer" saves it as ``always``: it works every time.
- "Just this time" saves it as ``ask``: it works for this session and asks again next time.
- "No, only view here" saves it as ``view``: heavy work waits for one of the other computers.

Every computer the drive has been plugged into is kept in the ``computers`` table, inside the
library, with its choice; Settings → Storage can change it or forget the computer. Computers are
told apart by a scrambled form of Windows' own computer ID; the ID itself is never stored, and
nothing is written to the computer.

The very first computer to open a library (before this feature, or on a new library) is saved as
``always`` without asking, so the owner's own computer keeps working as before.
"""

from __future__ import annotations

import hashlib
import logging
import os
import socket
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from engine.database import db_connection

logger = logging.getLogger("securephotos.computers")

ALWAYS = "always"
ASK = "ask"
VIEW = "view"
CHOICES = (ALWAYS, ASK, VIEW)

# Answers to the question, and the choice each one saves.
ANSWERS = {"remember": ALWAYS, "this_time": ASK, "view": VIEW}

# Why background work is waiting, as shown in Activity.
HOLD_REASON = "other_computer"

# This computer, for this run of the engine. ``session`` is the answer for this session when the
# saved choice is ``ask`` (or there is none yet): True works, False doesn't, None not answered.
_this: Dict[str, Any] = {"id": None, "name": None, "choice": None, "session": None}


def _windows_machine_guid() -> Optional[str]:
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        ) as key:
            value, _ = winreg.QueryValueEx(key, "MachineGuid")
            return str(value) if value else None
    except OSError:
        return None


def scrambled_id(raw: str) -> str:
    """The form of a computer ID that is stored: one-way, so the real ID can't be read back."""
    return hashlib.sha256(f"securephotos-computer:{raw}".encode("utf-8")).hexdigest()[:32]


def detect_this_computer() -> Dict[str, str]:
    """This computer's stored ID and its name as Windows shows it."""
    raw = _windows_machine_guid() or f"node-{uuid.getnode():x}"
    name = os.environ.get("COMPUTERNAME") or socket.gethostname() or "This computer"
    return {"id": scrambled_id(raw), "name": name}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


async def register_this_computer(detected: Optional[Dict[str, str]] = None) -> None:
    """At start-up: finds this computer in the library, or saves the very first one as ``always``."""
    me = detected or detect_this_computer()
    _this.update(id=me["id"], name=me["name"], choice=None, session=None)
    async with db_connection() as conn:
        async with conn.execute("SELECT choice FROM computers WHERE id = ?;", (me["id"],)) as cur:
            row = await cur.fetchone()
        if row is not None:
            _this["choice"] = row[0] if row[0] in CHOICES else ASK
            await conn.execute("UPDATE computers SET name = ?, last_seen = ? WHERE id = ?;", (me["name"], _now(), me["id"]))
        else:
            async with conn.execute("SELECT COUNT(*) FROM computers;") as cur:
                known = (await cur.fetchone())[0]
            if known == 0:
                await conn.execute(
                    "INSERT INTO computers (id, name, choice, first_seen, last_seen) VALUES (?, ?, ?, ?, ?);",
                    (me["id"], me["name"], ALWAYS, _now(), _now()),
                )
                _this["choice"] = ALWAYS
                logger.info("First computer for this library: %s does the background work.", me["name"])
        await conn.commit()


def may_do_background_work() -> bool:
    """True when heavy automatic work may run on this computer now.

    Before start-up has looked the computer up (tests, scripts) nothing is held.
    """
    if _this["id"] is None or _this["choice"] == ALWAYS:
        return True
    if _this["choice"] == VIEW:
        return False
    return _this["session"] is True


def lookup_failed() -> None:
    """Start-up couldn't look this computer up: hold heavy work rather than guess."""
    _this.update(id="unknown", name=None, choice=VIEW, session=False)


def hold_reason() -> Optional[str]:
    """``other_computer`` while heavy automatic work must wait for another computer, else None."""
    return None if may_do_background_work() else HOLD_REASON


def needs_answer() -> bool:
    """True when the app should ask the question: a new computer, or one set to "Asks each time"."""
    return _this["id"] not in (None, "unknown") and _this["choice"] in (None, ASK) and _this["session"] is None


async def answer(choice: str) -> None:
    """Saves the answer to the question for this computer (``remember``, ``this_time`` or ``view``)."""
    if choice not in ANSWERS:
        raise ValueError(choice)
    await set_choice(_this["id"], ANSWERS[choice])
    _this["session"] = choice != "view"


async def set_choice(computer_id: str, choice: str) -> bool:
    """Saves a computer's choice. This computer is added if it isn't listed yet; returns False for
    an unknown other computer."""
    if choice not in CHOICES:
        raise ValueError(choice)
    is_this = computer_id == _this["id"]
    async with db_connection() as conn:
        cur = await conn.execute("UPDATE computers SET choice = ? WHERE id = ?;", (choice, computer_id))
        if cur.rowcount == 0:
            if not is_this:
                return False
            await conn.execute(
                "INSERT INTO computers (id, name, choice, first_seen, last_seen) VALUES (?, ?, ?, ?, ?);",
                (computer_id, _this["name"], choice, _now(), _now()),
            )
        await conn.commit()
    if is_this:
        if choice == ASK:
            # From Settings: this session keeps doing what it did; the question comes next start.
            _this["session"] = may_do_background_work()
        _this["choice"] = choice
    return True


async def forget(computer_id: str) -> bool:
    """Takes a computer off the list; it is asked again the next time the drive is plugged in."""
    async with db_connection() as conn:
        cur = await conn.execute("DELETE FROM computers WHERE id = ?;", (computer_id,))
        await conn.commit()
        removed = cur.rowcount > 0
    if removed and computer_id == _this["id"]:
        _this.update(choice=None, session=None)
    return removed


async def list_computers() -> Dict[str, Any]:
    """This computer and every computer the library knows, most recently used first."""
    async with db_connection() as conn:
        async with conn.execute(
            "SELECT id, name, choice, first_seen, last_seen FROM computers ORDER BY last_seen DESC, name;"
        ) as cur:
            rows = await cur.fetchall()
    computers: List[Dict[str, Any]] = [
        {"id": r[0], "name": r[1], "choice": r[2], "first_seen": r[3], "last_seen": r[4], "is_this": r[0] == _this["id"]}
        for r in rows
    ]
    return {
        "this_computer": {
            "id": _this["id"],
            "name": _this["name"],
            "choice": _this["choice"],
            "does_work_now": may_do_background_work(),
            "needs_answer": needs_answer(),
        },
        "computers": computers,
    }
