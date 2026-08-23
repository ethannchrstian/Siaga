"""Deep candidates for the model comparison: an LSTM and a spatiotemporal GNN.

Both exist to answer one question the semifinal scored us badly on: was the
model family chosen, or defaulted to? They plug into compare_models.py and run
through the identical split, calibration and metrics as the tree models.

**LSTM.** The incumbent reads hand-engineered aggregates (rainfall over 1, 3, 7
and 30 days, discharge, its 7-day mean, its 3-day change). The LSTM instead
reads the raw 30 daily values of rainfall and discharge and learns its own
representation. This mirrors Google Flood Hub (Nearing et al., Nature 627, 2024),
which our concept paper already cites, so it is the natural comparison rather
than an arbitrary one.

**Spatiotemporal GNN.** Our concept paper proposes this in Pekerjaan Lanjutan
and never built it. Districts are nodes, shared borders are edges, and each
day's graph is processed together, so a prediction for one kecamatan can draw on
what is happening upstream and next door. Two things motivate it:

  1. Water is a network. The February 2024 Demak flood arrived from Grobogan
     upstream; the tabular model only caught it because GloFAS discharge has
     routing baked in, not because it can represent the relationship.
  2. The coupling thesis. Today flood and drought meet only in the crew-pool
     constraint, which is an operational coupling. A shared latent
     representation couples them inside the model, which is what the paper
     actually claims.

The paper's own caveat is worth repeating: GloFAS discharge already contains
upstream routing, so part of the graph's structural advantage is pre-absorbed.
We expect that to show up in the numbers, and we report it either way.

**Mass conservation.** The paper asks for a conservation term binding storage
change to precipitation, evapotranspiration and runoff. Evapotranspiration is
not observed in our data, so the budget cannot be closed exactly. We impose the
soft form instead: the model emits a latent storage channel per node per day and
is penalised when its day-to-day change departs from rainfall minus scaled
discharge, with the scale learned. That is a physical prior, not a physical law,
and it is described that way in the paper.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

SEED = 42
# flood is daily, so 30 steps is 30 days. drought is monthly and the panel is
# only 114 months long, so a 30-step window would swallow a quarter of it.
SEQ_LEN = {"flood": 30, "drought": 12}
HIDDEN = 64
EPOCHS = 8
LR = 3e-3
MASS_LAMBDA = 0.05     # weight on the conservation penalty
FOLDS = 5

DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# raw daily channels the deep models read instead of hand-made aggregates
RAW_FLOOD = ["rain_1d", "disc_now"]
RAW_DROUGHT = ["p1", "spi1"]
STATIC = ["coastal"]


def _seed() -> None:
    torch.manual_seed(SEED)
    np.random.seed(SEED)


# ------------------------------------------------------------------ tensors
def build_panel(df: pd.DataFrame, raw: list[str], label: str,
                date_col: str = "date"):
    """Reshape the long table into (n_dates, n_nodes, ...) tensors.

    Every district in flood_dataset.parquet has an identical, gap-free daily
    index, which makes this a plain pivot. We assert that rather than assume it.
    """
    ids = sorted(df["district_id"].unique())
    dates = sorted(df[date_col].unique())
    n_d, n_n = len(dates), len(ids)
    if len(df) != n_d * n_n:
        raise ValueError(
            "panel is ragged: %d rows for %d dates x %d districts"
            % (len(df), n_d, n_n)
        )

    d = df.sort_values(["district_id", date_col])
    node_index = {k: i for i, k in enumerate(ids)}

    X = np.stack(
        [d[c].to_numpy(dtype=np.float32).reshape(n_n, n_d).T for c in raw],
        axis=-1,
    )  # (n_dates, n_nodes, n_raw)
    S = np.stack(
        [d[c].to_numpy(dtype=np.float32).reshape(n_n, n_d).T for c in STATIC],
        axis=-1,
    )
    mon = d["month"].to_numpy(dtype=np.float32).reshape(n_n, n_d).T
    S = np.concatenate(
        [S, np.sin(2 * np.pi * mon / 12)[..., None],
         np.cos(2 * np.pi * mon / 12)[..., None]], axis=-1
    )
    y = d[label].to_numpy(dtype=np.float32).reshape(n_n, n_d).T
    return X, S, y, ids, np.array(dates), node_index


def make_windows(X: np.ndarray, seq_len: int) -> np.ndarray:
    """(n_dates, n_nodes, n_raw) -> (n_dates, n_nodes, seq_len, n_raw).

    The first seq_len-1 days have no full history, so they repeat the earliest
    observation. Padding rather than dropping keeps the row set identical to
    the tabular models, which is what makes the comparison fair.
    """
    n_d = X.shape[0]
    idx = np.arange(n_d)[:, None] - np.arange(seq_len - 1, -1, -1)[None, :]
    return X[np.clip(idx, 0, None)].transpose(0, 2, 1, 3)


def adjacency(ids: list[str]) -> torch.Tensor:
    """Symmetric normalised adjacency from shared kecamatan borders.

    Falls back to a nearest-neighbour graph on centroids if the polygons yield
    an isolated node, so no district is ever cut off from the message passing.
    """
    import geopandas as gpd

    g = gpd.read_file(DATA / "districts.geojson")
    g = g[g["district_id"].isin(ids)].set_index("district_id").loc[ids]
    n = len(ids)

    A = np.eye(n, dtype=np.float32)
    geoms = g.geometry.to_numpy()
    # GADM polygons are digitised independently and do not share exact edges,
    # so a strict `touches` test finds almost no neighbours. Buffer by roughly
    # 500 m and test intersection instead.
    # buffering in degrees is deliberate here: 0.005 deg is roughly 550 m at
    # this latitude, enough to close digitisation slivers and nothing more.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        buffered = gpd.GeoSeries(geoms, crs=g.crs).buffer(0.005)
    sindex = buffered.sindex
    for i in range(n):
        for j in sindex.query(buffered.iloc[i], predicate="intersects"):
            if int(j) != i:
                A[i, int(j)] = A[int(j), i] = 1.0

    iso = int((A.sum(1) <= 1).sum())
    if iso:
        cent = np.stack([geoms[i].centroid.coords[0] for i in range(n)])
        for i in np.where(A.sum(1) <= 1)[0]:
            d = ((cent - cent[i]) ** 2).sum(1)
            for j in np.argsort(d)[1:4]:
                A[i, j] = A[j, i] = 1.0
        print("    %d isolated districts linked to 3 nearest centroids" % iso)

    deg = A.sum(1, keepdims=True)
    A_hat = A / np.sqrt(deg) / np.sqrt(deg.T)
    print("    graph: %d nodes, %d edges, mean degree %.1f"
          % (n, int(A.sum() - n) // 2, A.sum(1).mean() - 1))
    return torch.tensor(A_hat, device=DEV)


# ------------------------------------------------------------------- models
class SeqEncoder(nn.Module):
    """Shared temporal encoder. Reads the raw window, emits a node embedding
    and one latent storage scalar used by the conservation penalty."""

    def __init__(self, n_raw: int, n_static: int, hidden: int = HIDDEN):
        super().__init__()
        self.lstm = nn.LSTM(n_raw, hidden, batch_first=True)
        self.static = nn.Linear(n_static, hidden)
        self.storage = nn.Linear(hidden, 1)

    def forward(self, seq, static):
        # seq (N, L, C) -> last hidden state (N, H)
        _, (h, _) = self.lstm(seq)
        h = h[-1]
        z = torch.relu(h + self.static(static))
        return z, self.storage(z).squeeze(-1)


class LSTMHead(nn.Module):
    """LSTM only. No graph, so this isolates the value of the learned temporal
    representation from the value of the spatial structure."""

    def __init__(self, n_raw: int, n_static: int):
        super().__init__()
        self.enc = SeqEncoder(n_raw, n_static)
        self.out = nn.Linear(HIDDEN, 1)

    def forward(self, seq, static, A=None):
        z, s = self.enc(seq, static)
        return self.out(z).squeeze(-1), s


class STGNN(nn.Module):
    """Temporal encoder, then two graph convolutions over district adjacency."""

    def __init__(self, n_raw: int, n_static: int):
        super().__init__()
        self.enc = SeqEncoder(n_raw, n_static)
        self.g1 = nn.Linear(HIDDEN, HIDDEN)
        self.g2 = nn.Linear(HIDDEN, HIDDEN)
        self.out = nn.Linear(HIDDEN, 1)

    def forward(self, seq, static, A):
        z, s = self.enc(seq, static)
        z = torch.relu(A @ self.g1(z)) + z      # residual keeps the node's own
        z = torch.relu(A @ self.g2(z)) + z      # signal from being washed out
        return self.out(z).squeeze(-1), s


def mass_penalty(storage, rain, disc, alpha):
    """Storage change should track rainfall minus scaled discharge.

    Evapotranspiration is unobserved here, so this closes the budget only up to
    a learned scale. It is a prior, not a law.
    """
    ds = storage[1:] - storage[:-1]
    forcing = rain[1:] - alpha * disc[1:]
    return ((ds - forcing) ** 2).mean()


# ------------------------------------------------------------------ fitting
def _fit_predict(model_cls, Xw, S, y, A, train_idx, pred_idx, raw_scale):
    _seed()
    n_raw, n_static = Xw.shape[-1], S.shape[-1]
    model = model_cls(n_raw, n_static).to(DEV)
    alpha = nn.Parameter(torch.tensor(0.1, device=DEV))
    opt = torch.optim.Adam(list(model.parameters()) + [alpha], lr=LR)

    pos = y[train_idx].mean()
    pos_weight = torch.tensor(
        float(np.sqrt((1 - pos) / max(pos, 1e-6))), device=DEV)
    lossf = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    Xt = torch.tensor(Xw, device=DEV)
    St = torch.tensor(S, device=DEV)
    yt = torch.tensor(y, device=DEV)

    for ep in range(EPOCHS):
        model.train()
        order = np.random.permutation(train_idx)
        tot = 0.0
        for t in order:
            opt.zero_grad()
            logit, storage = model(Xt[t], St[t], A)
            loss = lossf(logit, yt[t])
            # conservation needs two consecutive days to form a difference
            if t > 0:
                _, prev = model(Xt[t - 1], St[t - 1], A)
                pair = torch.stack([prev, storage])
                rain = Xt[t - 1:t + 1, :, -1, 0] * raw_scale[0]
                disc = Xt[t - 1:t + 1, :, -1, -1] * raw_scale[1]
                loss = loss + MASS_LAMBDA * mass_penalty(pair, rain, disc, alpha)
            loss.backward()
            opt.step()
            tot += float(loss)
        print("      epoch %d/%d  loss %.4f" % (ep + 1, EPOCHS, tot / len(order)))

    model.eval()
    out = np.zeros((len(pred_idx), y.shape[1]), dtype=np.float32)
    with torch.no_grad():
        for k, t in enumerate(pred_idx):
            logit, _ = model(Xt[t], St[t], A)
            out[k] = torch.sigmoid(logit).cpu().numpy()
    return out


def _run(model_cls, dev, te, raw, label, seq_len):
    """Date-grouped 5-fold OOF on development years, then refit and predict test.

    Folding by date rather than by row keeps a district-day and its neighbours
    in the same fold. That is stricter than the row-wise CV the tree models get,
    not laxer, so any advantage this shows is not an artefact of the protocol.
    """
    full = pd.concat([dev, te], ignore_index=True)
    X, S, y, ids, dates, _ = build_panel(full, raw, label)
    Xw = make_windows(X, seq_len)

    mu, sd = Xw.mean((0, 1, 2)), Xw.std((0, 1, 2)) + 1e-6
    Xw = (Xw - mu) / sd
    raw_scale = (float(sd[0]), float(sd[-1]))

    A = adjacency(ids)
    n_dev_dates = len(np.unique(dev["date"]))
    dev_t = np.arange(n_dev_dates)
    te_t = np.arange(n_dev_dates, len(dates))

    oof = np.zeros((n_dev_dates, len(ids)), dtype=np.float32)
    folds = np.array_split(np.random.RandomState(SEED).permutation(dev_t), FOLDS)
    for f, hold in enumerate(folds, 1):
        tr = np.setdiff1d(dev_t, hold)
        print("    fold %d/%d  train %d dates, hold %d" % (f, FOLDS, len(tr), len(hold)))
        oof[hold] = _fit_predict(model_cls, Xw, S, y, A, tr, hold, raw_scale)

    print("    refit on all development dates")
    te_pred = _fit_predict(model_cls, Xw, S, y, A, dev_t, te_t, raw_scale)

    # back to the long row order the comparison harness expects
    def flatten(mat, tsel):
        return mat.T.reshape(-1)

    return flatten(oof, dev_t), flatten(te_pred, te_t)


def deep_candidates(head: str) -> dict:
    raw = RAW_FLOOD if head == "flood" else RAW_DROUGHT

    def lstm(dev, te, feats, label):
        print("  [lstm] device %s" % DEV)
        return _run(LSTMHead, dev, te, raw, label, SEQ_LEN[head])

    def stgnn(dev, te, feats, label):
        print("  [st-gnn] device %s" % DEV)
        return _run(STGNN, dev, te, raw, label, SEQ_LEN[head])

    return {"lstm": lstm, "stgnn_mass": stgnn}
