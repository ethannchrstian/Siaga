import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import allocate, auth, decisions, districts, model_info, risk

log = logging.getLogger("siaga")

# Built frontend, copied here by the Docker build. Absent during local dev,
# where Vite serves the UI on :5173 instead.
STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Touch the caches at boot so the first visitor doesn't pay for the parquet
    # load. On a cold container that is a few seconds, which is exactly when
    # someone is deciding whether the app works.
    try:
        from app.services import scenario

        scenario.district_meta()
        scenario.risk_history()
        scenario.date_bounds()
        log.info("caches warmed")
    except Exception:  # never let warmup stop the server coming up
        log.exception("warmup failed; serving anyway")
    yield


app = FastAPI(title="SIAGA API", version="1.0.0", lifespan=lifespan)

# Same-origin in production, so CORS matters only for local dev and for the
# case where the frontend is hosted separately. SIAGA_ALLOWED_ORIGINS takes a
# comma-separated list.
_origins = os.getenv(
    "SIAGA_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(districts.router)
app.include_router(risk.router)
app.include_router(allocate.router)
app.include_router(decisions.router)
app.include_router(auth.router)
app.include_router(model_info.router)


@app.get("/health")
def health():
    """Liveness probe. Hosting platforms poll this to decide the app is up."""
    return {"status": "ok", "service": "siaga-api", "ui": STATIC_DIR.exists()}


# Mounted last so it never shadows an API route.
if STATIC_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_DIR / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Serve the built UI, falling back to index.html for client routes."""
        candidate = (STATIC_DIR / full_path).resolve()
        # Only serve real files that stay inside the static dir.
        if (
            full_path
            and candidate.is_file()
            and STATIC_DIR.resolve() in candidate.parents
        ):
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
