import type { ResetStyle, UsageSnapshot } from "../types.ts";
import type { CodexAuthConfig } from "../auth.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 8_000;

export function parseCodexUsageResponse(data: unknown, now = Date.now()): UsageSnapshot {
  const root = asRecord(data);
  const rateLimit = asRecord(root.rate_limit ?? root);
  const limits = [
    parseWindow("5h", asRecord(rateLimit.primary_window), now, "relative"),
    parseWindow("week", asRecord(rateLimit.secondary_window), now, "weekday"),
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
  const primary = parseWindow("spark 5h", asRecord(rateLimit.primary_window), now, "relative");
  const secondary = parseWindow("spark week", asRecord(rateLimit.secondary_window), now, "weekday");
  return [primary, secondary].filter((limit) => limit !== null);
}

function parseWindow(label: string, value: Record<string, unknown>, now: number, resetStyle: ResetStyle) {
  const percentage = numberValue(value.used_percent);
  const nextResetTime = resetTime(value, now);
  if (percentage === null || nextResetTime === null) return null;
  return { label, percentage, nextResetTime, resetStyle };
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
