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
# frontend/.npmrc pins registry.npmjs.org. Without it a machine-level mirror in
# ~/.npmrc leaks into the lockfile and npm ci fails inside this container.
COPY frontend/.npmrc ./
RUN npm ci

COPY frontend/ ./
# No VITE_API_BASE: the app calls relative paths and hits this same container.
RUN npm run build


# ---- stage 2: runtime ------------------------------------------------------
FROM python:3.13-slim AS runtime

# PORT has a default so the container is deterministic on hosts that do not
# inject one. Hugging Face routes to the README's app_port and sets nothing;
# Render and Railway inject PORT at runtime, which overrides this.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# Serving requirements only: no GDAL toolchain, no xgboost. See
# backend/requirements.txt for why. Installed as root, before the user switch
# below, so site-packages stays world-readable and shared.
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# PuLP ships a CBC binary; make sure it stays executable for the unprivileged
# user below, not just for root.
RUN chmod -R a+rx /usr/local/lib/python3.13/site-packages/pulp/solverdir || true

# Hugging Face Spaces runs the container as uid 1000, so give that uid a real
# account and home directory rather than letting it land nowhere. The solver
# shells out to CBC and writes .lp and .sol scratch files, and a uid with no
# writable home is how that fails.
RUN useradd -m -u 1000 user
ENV HOME=/home/user
USER user
WORKDIR $HOME/app

# --chown on each COPY rather than a recursive chown afterwards: chown -R
# rewrites metadata for every file, which duplicates all of them into a new
# layer.
COPY --chown=user backend/app ./app
COPY --chown=user backend/data ./data
# Measured calibration, read by /scenario so the interface can say what a
# probability historically verified at. Small, and produced offline by
# ml/run_reliability.py.
COPY --chown=user backend/results ./results

# The built UI lands where main.py looks for it.
COPY --chown=user --from=ui /ui/dist ./app/static

EXPOSE 8000

# Single worker: the CBC solve is CPU-bound and the free tiers this targets have
# one or two cores, so extra workers only add memory pressure.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
