# SIAGA: one container serving both the API and the built UI.
#
# Single service on purpose. A split frontend/backend deployment needs CORS
# config and a cross-origin API base, which is two more things to get wrong the
# morning of a demo. Here the bundle and the API share an origin.

# ---- stage 1: build the frontend -------------------------------------------
FROM node:22-slim AS ui

WORKDIR /ui
# Copy manifests first so npm ci is cached until dependencies actually change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# No VITE_API_BASE: the app calls relative paths and hits this same container.
RUN npm run build


# ---- stage 2: runtime ------------------------------------------------------
FROM python:3.13-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

# Serving requirements only: no GDAL toolchain, no xgboost. See
# backend/requirements.txt for why.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/data ./data

# The built UI lands where main.py looks for it.
COPY --from=ui /ui/dist ./app/static

# PuLP ships a CBC binary; make sure it is executable in this image.
RUN chmod -R a+rx /usr/local/lib/python3.13/site-packages/pulp/solverdir || true

EXPOSE 8000

# Hosts inject $PORT. Single worker: the CBC solve is CPU-bound and the free
# tiers this targets have one core, so extra workers only add memory pressure.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
