"""Grounded natural-language explanations of a SIAGA plan.

This is the mirror of the ROB layer: it observes the plan and puts it into
words, and it never touches the optimizer. The model is given only the facts the
solver already produced (the plan rows, the unserved reasons, the summary) and
is told, in the system prompt, to invent nothing and to decide nothing. The real
numbers stay on screen next to whatever it writes, so any drift is visible.

The key lives in backend/.env (gitignored), read here into the environment so
uvicorn does not need python-dotenv. No key means the feature reports itself
unavailable rather than crashing the API.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND / ".env"

# A "lite" model on purpose: the full flash models are thinking models whose
# free tier is a few dozen requests per DAY (easily spent in a demo), while the
# lite model has a far higher free daily quota, answers in ~3.5s, and needs no
# thinking budget. Plenty for grounded phrasing. One-line change to swap.
MODEL = "gemini-3.5-flash-lite"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

TIMEOUT_S = 30
MAX_UNSERVED = 15          # the operator reads the worst-exposed few, not all 300
DEMO_RATE_WINDOW_S = 60
USAGE_FILE = BACKEND / "data" / "ai_usage.json"
_cache: dict[str, str] = {}
_usage_lock = threading.Lock()
_recent_demo_requests: dict[str, deque[float]] = defaultdict(deque)


def _load_env() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

DEMO_DAILY_LIMIT = int(os.getenv("AI_DEMO_DAILY_LIMIT", "50"))
DEMO_RATE_LIMIT = int(os.getenv("AI_DEMO_RATE_LIMIT", "3"))
DEMO_MAX_OUTPUT_TOKENS = int(os.getenv("AI_DEMO_MAX_OUTPUT_TOKENS", "600"))


def is_configured(role: str | None = None) -> bool:
    if role == "DEMO":
        return bool(os.environ.get("GEMINI_DEMO_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    return bool(os.environ.get("GEMINI_API_KEY"))


# A compact, accurate guide to the real UI so the assistant can answer
# "how do I..." and "what does X do" without inventing buttons. Every item here
# maps to a control that exists in the app; the model is told to stay inside it.
FEATURES = (
    "PANDUAN FITUR SIAGA (untuk pertanyaan 'apa fungsi' atau 'bagaimana cara'):\n"
    "- Peta: menampilkan koridor Pantura dengan tiga mode tampilan, peluang "
    "banjir, peluang cekaman air, dan alokasi (penempatan pompa dan truk tangki). "
    "Legenda risiko menjelaskan arti warna. Klik sebuah kecamatan untuk detailnya; "
    "klik sebuah depot untuk melihat perkiraan jangkauannya (area yang dapat "
    "ditempuh dalam batas waktu tiba).\n"
    "- Rekomendasi keputusan (panel kanan): daftar kecamatan yang diusulkan "
    "optimizer. Filternya: Semua, Menunggu, Dua Bahaya (banjir dan cekaman air "
    "sekaligus), Banjir, dan Cekaman air. Ada kolom cari untuk menemukan kecamatan.\n"
    "- Keputusan operator: untuk tiap rekomendasi, operator bisa mengunci "
    "(menetapkan), mengalihkan, atau membatalkan alokasi. SIAGA hanya mengusulkan; "
    "keputusan akhir ada di operator lewat gerbang otorisasi sebelum menekan "
    "'Terbitkan perintah'.\n"
    "- Sumber armada yang boleh dipakai: mengatur depot mana yang boleh memasok "
    "sebuah kecamatan. Bila lebih dari satu depot tersedia, muncul dropdown pilihan.\n"
    "- Ambang dan hitung ulang: Ambang Alokasi Kritis, Ambang Pemantauan, dan "
    "Maksimal waktu tiba dapat diubah, lalu tekan hitung ulang / putar ulang untuk "
    "menyusun rencana baru.\n"
    "- Angka operasional: Jiwa terpapar, Total unit, Cakupan rencana, dan Selisih "
    "terburuk (cakupan pada 10% hari terburuk dibanding mode dua meja terpisah).\n"
    "- Kinerja model: AUC, average precision, Brier, dan kalibrasi isotonik untuk "
    "model banjir dan cekaman air, menunjukkan seberapa andal prediksinya.\n"
    "- Tanya SIAGA: fitur ini sendiri, menjelaskan rencana dan cara pakai; tidak "
    "pernah mengubah alokasi."
)

SYSTEM = (
    "Anda asisten yang MENJELASKAN rencana prapenempatan SIAGA dan cara memakai "
    "aplikasinya kepada operator Pusdalops. Aturan wajib:\n"
    "1. Gunakan HANYA data yang diberikan. Jangan pernah mengarang angka, nama "
    "kecamatan, atau depot.\n"
    "2. Jika informasi tidak ada dalam data, katakan bahwa informasi itu tidak "
    "tersedia dalam rencana ini.\n"
    "3. Anda TIDAK membuat keputusan alokasi. Optimizer yang memutuskan; Anda "
    "hanya menerjemahkan hasilnya ke bahasa yang mudah dibaca.\n"
    "4. Setiap kecamatan punya peluang banjir dan cekaman air. Armada langka: "
    "'ringkasan.total_fleet' memberi jumlah pompa dan truk tangki di koridor. "
    "Jika ditanya kenapa sebuah kecamatan tidak menerima jenis armada tertentu, "
    "jelaskan berdasarkan peluang bahayanya, kelangkaan armada itu, dan bahwa "
    "optimizer memprioritaskan kecamatan yang melindungi paparan terbesar. "
    "Tetap jangan mengarang angka yang tidak ada.\n"
    "5. FORMAT agar mudah dibaca: mulai dengan satu kalimat ringkas, lalu bila "
    "ada beberapa hal gunakan poin pendek yang diawali '- '. Boleh menandai kata "
    "kunci dengan **tebal**. Hindari satu paragraf panjang. Bahasa Indonesia, "
    "tanpa tanda hubung em.\n"
    "6. Jangan tampilkan nama field teknis (seperti flood_prob, truk_tangki, "
    "people_exposed). Gunakan istilah biasa: 'peluang banjir', 'peluang cekaman "
    "air', 'truk tangki air', 'jiwa terpapar'.\n"
    "7. Selain menjelaskan rencana, Anda boleh menjelaskan FUNGSI atau CARA "
    "MENGGUNAKAN fitur SIAGA, tetapi HANYA berdasarkan 'PANDUAN FITUR' di bawah. "
    "Jangan mengarang fitur, tombol, atau langkah yang tidak tercantum di sana. "
    "Jika sebuah fitur tidak ada di panduan, katakan Anda tidak yakin fitur itu "
    "tersedia.\n\n"
    + FEATURES
)


def _facts(ctx: dict) -> str:
    """Compact, grounded snapshot of the plan for the prompt."""
    unserved = sorted(
        ctx.get("unserved", []),
        key=lambda u: -(u.get("people_exposed") or 0),
    )[:MAX_UNSERVED]
    snapshot = {
        "tanggal": ctx.get("date"),
        "ringkasan": ctx.get("summary", {}),
        "profil_pasokan": ctx.get("supply_profile", {}),
        "perbandingan": ctx.get("comparison", {}),
        "rencana": ctx.get("plan", []),
        "tidak_terlayani": unserved,
    }
    return json.dumps(snapshot, ensure_ascii=False, default=str)


def _prompt(ctx: dict, question: str | None) -> str:
    facts = _facts(ctx)
    if question:
        return (
            f"Pertanyaan operator: {question}\n\n"
            "Untuk pertanyaan tentang isi rencana, jawab hanya berdasarkan data "
            "di bawah. Untuk pertanyaan tentang fungsi atau cara memakai fitur, "
            "jawab berdasarkan PANDUAN FITUR pada instruksi sistem. Data rencana "
            f"(JSON):\n{facts}"
        )
    return (
        "Buat ringkasan briefing singkat (3 sampai 5 kalimat) tentang rencana "
        "prapenempatan ini. Sebutkan berapa kecamatan diprioritaskan, pembagian "
        "banjir dan cekaman air, dan satu atau dua wilayah paling terpapar yang "
        "belum terlayani beserta alasannya. Data (JSON):\n"
        f"{_facts(ctx)}"
    )


class LLMError(RuntimeError):
    pass


class DemoLimitError(LLMError):
    pass


def _read_usage() -> dict:
    if not USAGE_FILE.exists():
        return {}
    try:
        return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _write_usage(usage: dict) -> None:
    USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = USAGE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(usage, indent=2), encoding="utf-8")
    temporary.replace(USAGE_FILE)


def _consume_demo_quota(username: str) -> dict:
    """Reserve one upstream request before calling Gemini.

    The shared demo login intentionally has one shared budget. Cache hits never
    reach this function, so repeated identical questions cost no quota.
    """
    now = time.time()
    day = datetime.now(timezone.utc).date().isoformat()
    with _usage_lock:
        recent = _recent_demo_requests[username]
        while recent and now - recent[0] >= DEMO_RATE_WINDOW_S:
            recent.popleft()
        if len(recent) >= DEMO_RATE_LIMIT:
            raise DemoLimitError(
                f"Batas akun demo adalah {DEMO_RATE_LIMIT} pertanyaan per menit. "
                "Tunggu sebentar lalu coba lagi."
            )

        usage = _read_usage()
        record = usage.get(username, {})
        used = int(record.get("count", 0)) if record.get("date") == day else 0
        if used >= DEMO_DAILY_LIMIT:
            raise DemoLimitError(
                f"Kuota AI akun demo hari ini sudah habis ({DEMO_DAILY_LIMIT} pertanyaan). "
                "Akun admin tetap dapat menggunakan AI."
            )

        used += 1
        recent.append(now)
        usage[username] = {"date": day, "count": used}
        _write_usage(usage)
        return {"limit": DEMO_DAILY_LIMIT, "used": used, "remaining": DEMO_DAILY_LIMIT - used}


def explain(ctx: dict, question: str | None = None, actor: dict | None = None) -> dict:
    """Return {text, cached, model}. Raises LLMError on a hard failure."""
    role = (actor or {}).get("role", "PUSDALOPS")
    username = (actor or {}).get("username", "unknown")
    demo = role == "DEMO"
    key = (os.environ.get("GEMINI_DEMO_API_KEY") if demo else None) or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise LLMError("LLM belum dikonfigurasi: API key untuk akun ini tidak ditemukan.")

    prompt = _prompt(ctx, question)
    cache_key = hashlib.sha256(
        (SYSTEM + prompt).encode("utf-8")
    ).hexdigest()
    if cache_key in _cache:
        return {"text": _cache[cache_key], "cached": True, "model": MODEL}

    quota = _consume_demo_quota(username) if demo else None

    # The lite model does not burn output tokens on hidden reasoning, so a
    # modest cap holds the whole answer without a thinking budget.
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": DEMO_MAX_OUTPUT_TOKENS if demo else 1024,
        },
    }
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
    # One quiet retry: a transient network blip should not surface as an error
    # the operator has to puzzle over mid-demo.
    r = None
    for attempt in range(2):
        try:
            r = httpx.post(ENDPOINT, headers=headers, json=body, timeout=TIMEOUT_S)
            break
        except httpx.HTTPError:
            if attempt == 0:
                time.sleep(0.6)
                continue
            raise LLMError(
                "Tidak dapat terhubung ke layanan AI. Periksa koneksi internet "
                "lalu coba lagi."
            )

    if r.status_code == 429:
        raise LLMError(
            "Kuota AI sedang penuh sesaat (batas gratis). Tunggu beberapa detik "
            "lalu coba lagi."
        )
    if r.status_code != 200:
        detail = ""
        try:
            detail = r.json().get("error", {}).get("message", "")[:160]
        except Exception:
            pass
        raise LLMError(f"Layanan AI menolak permintaan (HTTP {r.status_code}). {detail}")

    data = r.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise LLMError("Model tidak mengembalikan jawaban (kemungkinan diblokir).")
    parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise LLMError("Model mengembalikan jawaban kosong.")

    _cache[cache_key] = text
    result = {"text": text, "cached": False, "model": MODEL}
    if quota is not None:
        result["quota"] = quota
    return result
