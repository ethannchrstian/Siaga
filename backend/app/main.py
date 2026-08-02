from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import districts

app = FastAPI(title="SIAGA API", version="0.1.0")

# Vite dev server origin. Tighten before any public deploy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(districts.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "siaga-api"}
