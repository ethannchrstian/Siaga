import { useEffect, useState } from "react";
import { getDistrictSeries, type DistrictSeries } from "../api/client";

interface Props {
  districtId: string;
  end: string; // the operator's selected date — never chart the future
}

const W = 244;
const H = 46;
const FLOOD = "#3478f6";
const DROUGHT = "#ff5a5f";

// Session cache: one fetch per (district, end-date).
const cache = new Map<string, DistrictSeries>();

// 60-day risk history as two polylines — the evidence that today's number
// comes from a model tracking a trend, not a hand-picked value.
export default function Sparkline({ districtId, end }: Props) {
  const [series, setSeries] = useState<DistrictSeries | null>(
    cache.get(`${districtId}:${end}`) ?? null,
  );

  useEffect(() => {
    const key = `${districtId}:${end}`;
    const hit = cache.get(key);
    if (hit) {
      setSeries(hit);
      return;
    }
    setSeries(null);
    let alive = true;
    getDistrictSeries(districtId, end)
      .then((s) => {
        cache.set(key, s);
        if (alive) setSeries(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [districtId, end]);

  // Do not reserve an unexplained blank panel while the history is loading or
  // when the endpoint has no usable series. The chart appears only with data.
  if (!series || series.dates.length < 2) return null;

  const pts = (vals: number[]) =>
    vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * W;
        const y = H - 3 - v * (H - 6);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const last = (vals: number[]) => {
    const v = vals[vals.length - 1];
    return { x: W, y: H - 3 - v * (H - 6) };
  };
  const lf = last(series.flood);
  const ld = last(series.drought);

  return (
    <div className="spark">
      <div className="spark-title">Riwayat 60 hari</div>
      <svg width={W} height={H} className="spark-svg">
        <polyline points={pts(series.flood)} fill="none" stroke={FLOOD} strokeWidth="1.5" className="spark-line" />
        <polyline points={pts(series.drought)} fill="none" stroke={DROUGHT} strokeWidth="1.5" className="spark-line" />
        <circle cx={lf.x} cy={lf.y} r="2.5" fill={FLOOD} />
        <circle cx={ld.x} cy={ld.y} r="2.5" fill={DROUGHT} />
      </svg>
      <div className="spark-legend">
        <span style={{ color: FLOOD }}>— banjir</span>
        <span style={{ color: DROUGHT }}>— cekaman air</span>
      </div>
    </div>
  );
}
