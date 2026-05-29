import type { UsageSnapshot } from "../types.ts";
import type { OpenCodeGoConfig } from "./opencode-go-config.ts";

const DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/";
const DASHBOARD_URL_SUFFIX = "/go";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const REQUEST_TIMEOUT_MS = 10_000;

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const patterns = {
  rolling: [
    new RegExp(String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`),
    new RegExp(String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`),
  ],
  weekly: [
    new RegExp(String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`),
    new RegExp(String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`),
  ],
  monthly: [
    new RegExp(String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`),
    new RegExp(String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`),
  ],
} as const;

interface WindowUsage { usagePercent: number; resetInSec: number }

export async function fetchOpenCodeGoUsage(config: OpenCodeGoConfig): Promise<UsageSnapshot> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(config.workspaceId)}${DASHBOARD_URL_SUFFIX}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        Cookie: `auth=${config.authCookie}`,
      },
    });
    if (!response.ok) {
      const text = sanitizeMessage(await response.text());
      throw new Error(`OpenCode Go dashboard HTTP ${response.status}: ${text}`);
    }

    return parseOpenCodeGoDashboard(await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenCode Go dashboard request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseOpenCodeGoDashboard(html: string, now = Date.now()): UsageSnapshot {
  const rolling = parseWindowUsage(html, patterns.rolling[0], patterns.rolling[1]);
  const weekly = parseWindowUsage(html, patterns.weekly[0], patterns.weekly[1]);
  const monthly = parseWindowUsage(html, patterns.monthly[0], patterns.monthly[1]);
  if (!rolling && !weekly && !monthly) {
    throw new Error("Could not parse OpenCode Go usage windows from dashboard HTML");
  }

  const limits: UsageSnapshot["limits"] = [];
  if (rolling) limits.push({ label: "5h", percentage: rolling.usagePercent, nextResetTime: now + Math.max(0, rolling.resetInSec) * 1000, resetStyle: "relative" });
  if (weekly) limits.push({ label: "week", percentage: weekly.usagePercent, nextResetTime: now + Math.max(0, weekly.resetInSec) * 1000, resetStyle: "weekday" });
  if (monthly) limits.push({ label: "month", percentage: monthly.usagePercent, nextResetTime: now + Math.max(0, monthly.resetInSec) * 1000, resetStyle: "date" });

  return { provider: "opencode-go", label: "OpenCode Go", limits };
}

function parseWindowUsage(html: string, pctFirst: RegExp, resetFirst: RegExp): WindowUsage | null {
  const pct = pctFirst.exec(html);
  if (pct) return validWindow(Number(pct[1]), Number(pct[2]));
  const reset = resetFirst.exec(html);
  if (reset) return validWindow(Number(reset[2]), Number(reset[1]));
  return null;
}

function validWindow(usagePercent: number, resetInSec: number): WindowUsage | null {
  if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) return null;
  return { usagePercent: Math.max(0, usagePercent), resetInSec: Math.max(0, resetInSec) };
}

function sanitizeMessage(text: string, maxLength = 120): string {
  return text.replace(/[\u001b\u009b][[\]()#;?]*(?:[\dA-PR-TZcf-nq-uy=><~]|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || "unknown";
}
