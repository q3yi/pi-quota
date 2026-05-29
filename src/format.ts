import type { UsageSeverity, UsageSnapshot, UsageStatusSegment } from "./types.ts";

const DAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const RESET_SYMBOL = "↻";
const SEGMENT_SEPARATOR = " · ";

export function formatUsageStatus(snapshot: UsageSnapshot): string {
  return formatUsageSegments(snapshot).map((segment) => segment.text).join(SEGMENT_SEPARATOR);
}

export function formatUsageSegments(snapshot: UsageSnapshot): UsageStatusSegment[] {
  return snapshot.limits.map((limit) => {
    const usedPercentage = clampPercentage(limit.percentage);
    const remainingPercentage = 100 - usedPercentage;
    const label = formatLimitLabel(limit.label);
    const resetTime = formatCompactResetTime(limit.nextResetTime, limit.resetStyle);
    return {
      text: `${label} ${Math.round(remainingPercentage)}% left ${RESET_SYMBOL} ${resetTime}`,
      usedPercentage,
      severity: severityForUsedPercentage(usedPercentage),
    };
  });
}

export function formatUsageReport(snapshot: UsageSnapshot): string {
  const limits = snapshot.limits.filter((limit) => isPrimaryLimit(snapshot.provider, limit.label));
  const lines = [`${snapshot.label}${snapshot.planLabel ? ` (${snapshot.planLabel})` : ""}`];
  for (const limit of limits) {
    const used = clampPercentage(limit.percentage);
    const remaining = 100 - used;
    const resetTime = formatCompactResetTime(limit.nextResetTime, limit.resetStyle);
    lines.push(
      `${formatLongLimitLabel(limit.label).padEnd(9)} ${progressBar(used)} used ${Math.round(used)}% · left ${Math.round(remaining)}% · resets in ${resetTime}`,
    );
  }
  if (limits.length === 0) lines.push("  no quota windows found");
  return lines.join("\n");
}

export function formatErrorState(_error: unknown): string {
  return "⚠ quota unavailable";
}

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `pi-quota: ${message || "failed to fetch quota"}`;
}

function formatCompactResetTime(timestamp: number, style: "relative" | "weekday" | "date"): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "now";
  const diff = timestamp - Date.now();
  if (diff <= 0) return "now";

  if (style === "weekday") return DAY_ABBREVIATIONS[new Date(timestamp).getUTCDay()]!;
  if (style === "date") {
    const days = Math.floor(diff / 86_400_000);
    if (days >= 1) return `${days}d`;
  }

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h${minutes}`;
}

function formatLimitLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized === "5h") return "5h";
  if (normalized === "week" || normalized === "weekly") return "1w";
  if (normalized === "month" || normalized === "monthly") return "1m";
  if (normalized === "spark 5h") return "s5h";
  if (normalized === "spark week" || normalized === "spark weekly") return "s1w";
  return label.replace(/\s+/g, "");
}

function formatLongLimitLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized === "5h") return "5 hours";
  if (normalized === "week" || normalized === "weekly") return "weekly";
  if (normalized === "month" || normalized === "monthly") return "monthly";
  return label;
}

function isPrimaryLimit(provider: UsageSnapshot["provider"], label: string): boolean {
  const normalized = label.toLowerCase();
  if (provider === "codex") return normalized === "5h" || normalized === "week" || normalized === "weekly";
  return normalized === "5h" || normalized === "week" || normalized === "weekly" || normalized === "month" || normalized === "monthly";
}

function progressBar(usedPercentage: number, width = 20): string {
  const filled = Math.round((clampPercentage(usedPercentage) / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function clampPercentage(percentage: number): number {
  if (!Number.isFinite(percentage)) return 0;
  return Math.max(0, Math.min(100, percentage));
}

function severityForUsedPercentage(usedPercentage: number): UsageSeverity {
  if (usedPercentage >= 90) return "critical";
  if (usedPercentage >= 75) return "warning";
  return "ok";
}
