export interface Toast {
  id: number;
  msg: string;
  kind: "lock" | "reject" | "info";
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-mark">
            {t.kind === "lock" ? "✓" : t.kind === "reject" ? "✕" : "•"}
          </span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
