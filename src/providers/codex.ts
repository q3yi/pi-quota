import type { ResetStyle, UsageSnapshot } from "../types.ts";
import type { CodexAuthConfig } from "../auth.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 8_000;

export function parseCodexUsageResponse(data: unknown, now = Date.now()): UsageSnapshot {
  const root = asRecord(data);
  const rateLimit = asRecord(root.rate_limit ?? root);
  const primaryWindow = asRecord(rateLimit.primary_window);
  const secondaryWindow = asRecord(rateLimit.secondary_window);
  // Older responses expose a 5-hour primary window plus a weekly secondary
  // window. The current weekly-only response exposes just primary_window.
  // Prefer an explicit duration/name when available, and otherwise use the
  // presence of the legacy secondary window to distinguish the two shapes.
  const hasSecondaryWindow = numberValue(secondaryWindow.used_percent) !== null;
  const limits = [
    parseWindow(inferWindowLabel(primaryWindow, hasSecondaryWindow ? "5h" : "week"), primaryWindow, now),
    parseWindow(inferWindowLabel(secondaryWindow, "week"), secondaryWindow, now),
    parseWindow("month", asRecord(rateLimit.monthly_window ?? rateLimit.month_window), now),
    ...parseSparkLimits(root, now),
  ].filter((limit): limit is NonNullable<typeof limit> => limit !== null);

  if (limits.length === 0) throw new Error("Codex usage response missing quota windows");

  const planLabel = stringValue(
    root.plan_type ?? asRecord(root.account).plan_type ?? asRecord(root.subscription).plan_type,
  );

  return { provider: "codex", label: "Codex", ...(planLabel ? { planLabel } : {}), limits };
}

export async function fetchCodexUsage(auth: Pick<CodexAuthConfig, "access" | "accountId">): Promise<UsageSnapshot> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(USAGE_URL, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth.access}`,
        referer: "https://chatgpt.com/codex/settings/usage",
        "x-openai-target-path": "/backend-api/wham/usage",
        ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
      },
    });
    if (!response.ok) throw new Error(`Codex usage HTTP ${response.status}`);
    return parseCodexUsageResponse(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Codex usage request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseSparkLimits(root: Record<string, unknown>, now: number) {
  const spark = Object.values(asRecord(root.additional_rate_limits)).find((value) =>
    stringValue(asRecord(value).limit_name)?.toLowerCase().includes("spark") === true,
  );
  if (!spark) return [];
  const rateLimit = asRecord(asRecord(spark).rate_limit);
  const primary = parseWindow("spark 5h", asRecord(rateLimit.primary_window), now);
  const secondary = parseWindow("spark week", asRecord(rateLimit.secondary_window), now);
  return [primary, secondary].filter((limit) => limit !== null);
}

function parseWindow(label: string, value: Record<string, unknown>, now: number) {
  const percentage = numberValue(value.used_percent);
  const nextResetTime = resetTime(value, now);
  if (percentage === null || nextResetTime === null) return null;
  return { label, percentage, nextResetTime, resetStyle: resetStyleForLabel(label) };
}

function inferWindowLabel(value: Record<string, unknown>, fallback: "5h" | "week" | "month"): "5h" | "week" | "month" {
  const name = [value.label, value.name, value.limit_name, value.window_name, value.period]
    .map(stringValue)
    .find((candidate): candidate is string => candidate !== undefined)
    ?.toLowerCase();
  if (name?.includes("month")) return "month";
  if (name?.includes("week")) return "week";
  if (name?.includes("hour") || name?.includes("5h")) return "5h";

  const duration = [value.limit_window_seconds, value.window_seconds, value.window_duration_seconds, value.duration_seconds, value.period_seconds]
    .map(numberValue)
    .find((candidate): candidate is number => candidate !== null);
  if (duration !== undefined) {
    if (duration >= 24 * 86_400) return "month";
    if (duration >= 5 * 86_400) return "week";
    if (duration <= 12 * 3_600) return "5h";
  }
  return fallback;
}

function resetStyleForLabel(label: string): ResetStyle {
  if (label === "week" || label === "spark week") return "weekday";
  if (label === "month") return "date";
  return "relative";
}

function resetTime(value: Record<string, unknown>, now: number): number | null {
  const resetAt = value.reset_at;
  if (typeof resetAt === "string") {
    const parsed = Date.parse(resetAt);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof resetAt === "number") return resetAt < 10_000_000_000 ? resetAt * 1000 : resetAt;
  const seconds = numberValue(value.reset_after_seconds);
  return seconds === null ? null : now + seconds * 1000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
