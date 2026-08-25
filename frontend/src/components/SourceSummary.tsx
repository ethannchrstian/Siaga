import { sourcesOf, type PlanItem } from "../api/client";
import { ChevronDownIcon } from "../icons";

interface Props {
  item?: PlanItem;
  items?: PlanItem[];
  full?: boolean;
  className?: string;
}

/** Keep the recommendation scannable while preserving the exact solver
 * manifest one click away. Full mode is used in detail drawers. */
export default function SourceSummary({ item, items, full = false, className = "" }: Props) {
  const sourceItems = items ?? (item ? [item] : []);
  const byDepot = new Map<string, ReturnType<typeof sourcesOf>[number]>();
  for (const planItem of sourceItems) {
    for (const source of sourcesOf(planItem)) {
      const current = byDepot.get(source.depot_id);
      byDepot.set(source.depot_id, current
        ? { ...current, units: current.units + source.units, minutes: Math.min(current.minutes, source.minutes) }
        : source);
    }
  }
  const sources = [...byDepot.values()].sort((a, b) => b.units - a.units || a.minutes - b.minutes);
  const manifest = (
    <ul className="source-manifest">
      {sources.map((source) => (
        <li key={source.depot_id}>
          <span><b>{source.units}</b> dari {source.depot}</span>
          <small>{source.minutes} menit</small>
        </li>
      ))}
    </ul>
  );

  if (full) return <div className={`source-summary is-full ${className}`.trim()}>{manifest}</div>;
  if (sources.length <= 2) {
    return (
      <span className={`source-summary is-inline ${className}`.trim()}>
        {sources.map((source) => `${source.units} dari ${source.depot}`).join(" · ")}
      </span>
    );
  }

  const lead = sources[0];
  return (
    <details className={`source-summary is-collapsible ${className}`.trim()}>
      <summary>
        <span>{lead.units} dari {lead.depot}</span>
        <b>+{sources.length - 1} depot lain</b>
        <ChevronDownIcon size={12} />
      </summary>
      {manifest}
    </details>
  );
}
