import clsx from "clsx";

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
  neutral: "bg-slate-100 text-slate-600"
};

export default function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold",
        TONE_CLASSES[tone]
      )}
    >
      {children}
    </span>
  );
}

export function VerifiedBadge({ verified }: { verified?: boolean }) {
  return verified ? <Badge tone="ok">Verificato</Badge> : <Badge tone="warn">Non verificato</Badge>;
}
