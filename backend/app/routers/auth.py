"""Sign-in for the operator console.

What this is: the server holds the credential as a salted scrypt hash, compares
in constant time, and issues an opaque session token. Nothing about the
password ships to the browser.

What this is not, stated here so nobody has to guess: the hazard and allocation
endpoints are still open. This gates the interface, not the API. Sessions live
in process memory, so a restart signs everyone out. Both are acceptable for a
console demonstrated on one machine and neither should be described as
production session handling. Protecting the data routes is a dependency per
router and is the obvious next step.

Hashing uses hashlib.scrypt from the standard library rather than passlib or
bcrypt, so the served image gains no dependency for a single account.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/auth")

USERS = Path(__file__).resolve().parents[2] / "data" / "users.json"

# scrypt parameters. n=2**14 keeps a login near 100 ms on the machines this
# runs on, which is slow enough to matter for guessing and fast enough that the
# sign-in does not feel broken.
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
DK_LEN = 32

SESSION_TTL_S = 12 * 3600

# Seeded on first run so a fresh clone can sign in without a setup step. This
# remains a demo credential; production deployments need managed identities.
DEFAULT_USER = "admin"
DEFAULT_PASSWORD = "adminletsgowin"
DEFAULT_DISPLAY = "Operator SIAGA"

_sessions: dict[str, dict] = {}


def _hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=DK_LEN,
    ).hex()


def _seed() -> dict:
    salt = os.urandom(16)
    users = {
        DEFAULT_USER: {
            "salt": salt.hex(),
            "hash": _hash(DEFAULT_PASSWORD, salt),
            "display": DEFAULT_DISPLAY,
            "role": "PUSDALOPS",
        }
    }
    USERS.parent.mkdir(parents=True, exist_ok=True)
    USERS.write_text(json.dumps(users, indent=2), encoding="utf-8")
    return users


def _users() -> dict:
    if not USERS.exists():
        return _seed()
    try:
        return json.loads(USERS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _seed()


class Credentials(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: Credentials) -> dict:
    user = _users().get(body.username.strip().lower())

    # Hash even when the user does not exist, so a missing account and a wrong
    # password take the same time and cannot be told apart by timing.
    salt = bytes.fromhex(user["salt"]) if user else os.urandom(16)
    expected = user["hash"] if user else _hash("", salt)
    candidate = _hash(body.password, salt)

    if not user or not hmac.compare_digest(candidate, expected):
        raise HTTPException(401, "nama pengguna atau kata sandi salah")

    token = secrets.token_urlsafe(32)
    _sessions[token] = {
        "username": body.username.strip().lower(),
        "display": user.get("display", "Operator SIAGA"),
        "role": user.get("role", "PUSDALOPS"),
        "expires": time.time() + SESSION_TTL_S,
    }
    return {"token": token, **_public(_sessions[token])}


def _public(session: dict) -> dict:
    return {"display": session["display"], "role": session["role"]}


@router.get("/me")
def me(authorization: str = Header(default="")) -> dict:
    """Validates a token so a reload can restore the session without asking
    for the password again."""
    token = authorization.removeprefix("Bearer ").strip()
    session = _sessions.get(token)
    if not session:
        raise HTTPException(401, "sesi tidak dikenal")
    if session["expires"] < time.time():
        _sessions.pop(token, None)
        raise HTTPException(401, "sesi kedaluwarsa")
    return _public(session)


@router.post("/logout")
def logout(authorization: str = Header(default="")) -> dict:
    _sessions.pop(authorization.removeprefix("Bearer ").strip(), None)
    return {"ok": True}
