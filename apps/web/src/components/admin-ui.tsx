import type { ReactNode } from "react";

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "n/a";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function statusLabel(status: string) {
  return status
    .split(/[_.]/)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ["failed", "requires_manual_retry", "canceled"].includes(status)
    ? "border-[#ff9aaa]/30 bg-[#782f3d]/35 text-[#ffd7dd]"
    : ["completed", "active", "published"].includes(status)
      ? "border-[#80d9b7]/25 bg-[#153f36]/70 text-[#bde5d9]"
      : "border-[var(--brass)]/25 bg-[rgba(214,173,95,0.12)] text-[var(--stone)]";

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2 py-1 text-xs ${tone}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function MetricCard({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[rgba(20,17,14,0.86)] p-4">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      {detail ? <p className="mt-2 text-sm text-[var(--muted)]">{detail}</p> : null}
    </section>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}
