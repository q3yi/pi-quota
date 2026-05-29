import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getCodexAuth } from "./auth.ts";
import { formatErrorMessage, formatErrorState, formatUsageReport, formatUsageSegments } from "./format.ts";
import { fetchCodexUsage } from "./providers/codex.ts";
import { fetchOpenCodeGoUsage } from "./providers/opencode-go.ts";
import { resolveOpenCodeGoConfigCached } from "./providers/opencode-go-config.ts";
import { createPeriodicRefresh } from "./timer.ts";
import { selectUsageProvider, type UsageProvider, type UsageSnapshot } from "./types.ts";

const STATUS_ID = "pi-quota";

type PiTheme = {
  bg?: (color: string, text: string) => string;
  fg?: (color: string, text: string) => string;
};

type PiContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1] & {
  model?: { provider?: string | null };
  modelRegistry?: { getApiKeyForProvider?: (provider: string) => Promise<string | undefined> };
  ui: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]["ui"] & { theme?: PiTheme };
};

export default function (pi: ExtensionAPI): void {
  let currentCtx: PiContext | null = null;
  let lastSnapshot: UsageSnapshot | null = null;
  let refreshSeq = 0;

  function showStatus(text: string | undefined, dim?: boolean): void {
    currentCtx?.ui.setWidget(STATUS_ID, undefined);
    currentCtx?.ui.setStatus(STATUS_ID, text && dim ? `◌ ${text}` : text);
  }

  function showSnapshotStatus(snapshot: UsageSnapshot, dim?: boolean): void {
    showStatus(formatThemedUsageStatus(snapshot), dim);
  }

  function formatThemedUsageStatus(snapshot: UsageSnapshot): string {
    const segments = formatUsageSegments(snapshot);
    const theme = currentCtx?.ui.theme;
    if (!theme?.bg || !theme.fg) return segments.map((segment) => segment.text).join(" · ");

    return segments
      .map((segment) => {
        const fillLength = Math.min(segment.text.length, Math.ceil((segment.text.length * segment.usedPercentage) / 100));
        const usedText = segment.text.slice(0, fillLength);
        const remainingText = segment.text.slice(fillLength);
        const color = colorForSeverity(segment.severity);
        return `${usedText ? theme.bg(color.background, usedText) : ""}${remainingText ? theme.fg(color.foreground, remainingText) : ""}`;
      })
      .join(theme.fg("muted", " · "));
  }

  async function fetchActiveUsage(provider: UsageProvider, ctx: PiContext): Promise<UsageSnapshot> {
    if (provider === "codex") {
      const stored = getCodexAuth();
      const refreshed = await ctx.modelRegistry?.getApiKeyForProvider?.("openai-codex");
      return fetchCodexUsage({ ...stored, access: refreshed ?? stored.access });
    }

    const config = await resolveOpenCodeGoConfigCached();
    if (config.state === "configured") return fetchOpenCodeGoUsage(config.config);
    if (config.state === "none") {
      throw new Error(`OpenCode Go config not found. Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE, or create: ${config.checkedPaths.join(", ")}`);
    }
    if (config.state === "incomplete") throw new Error(`OpenCode Go config missing ${config.missing} (source: ${config.source})`);
    throw new Error(`OpenCode Go config invalid (${config.source}): ${config.error}`);
  }

  async function refreshUsage(ctx: PiContext, dim?: boolean): Promise<void> {
    currentCtx = ctx;
    const seq = ++refreshSeq;
    const provider = selectUsageProvider(ctx.model);
    if (!provider) return showStatus(undefined);

    const stillCurrent = () => seq === refreshSeq && selectUsageProvider(currentCtx?.model) === provider;
    try {
      const snapshot = await fetchActiveUsage(provider, ctx);
      if (!stillCurrent()) return;
      lastSnapshot = snapshot;
      showSnapshotStatus(snapshot, dim);
    } catch (error) {
      if (!stillCurrent()) return;
      currentCtx?.ui.notify(formatErrorMessage(error), "error");
      showStatus(formatErrorState(error), dim);
    }
  }

  const controller = createPeriodicRefresh(async () => {
    if (currentCtx) await refreshUsage(currentCtx);
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    void refreshUsage(currentCtx).catch((err) => console.error("[pi-quota] startup error:", err));
  });

  pi.on("agent_start", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    controller.start();
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    controller.stop();
    void refreshUsage(currentCtx).catch((err) => console.error("[pi-quota] agent_end error:", err));
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx as PiContext;
    if (!selectUsageProvider(currentCtx.model)) return showStatus(undefined);
    if (lastSnapshot) showSnapshotStatus(lastSnapshot, true);
    void refreshUsage(currentCtx).catch((err) => console.error("[pi-quota] model_select error:", err));
  });

  pi.on("session_shutdown", () => controller.stop());

  pi.registerCommand("quota", {
    description: "Show Codex and OpenCode Go coding plan quota usage",
    handler: async (_args, ctx) => {
      const commandCtx = ctx as PiContext;
      currentCtx = commandCtx;
      const results = await Promise.allSettled([
        fetchActiveUsage("codex", commandCtx),
        fetchActiveUsage("opencode-go", commandCtx),
      ]);

      const sections = [
        formatCommandSection("Codex", results[0]),
        formatCommandSection("OpenCode Go", results[1]),
      ];
      ctx.ui.notify(sections.join("\n\n"), "info");

      const provider = selectUsageProvider(commandCtx.model);
      if (provider) void refreshUsage(commandCtx).catch((err) => console.error("[pi-quota] quota refresh error:", err));
    },
  });
}

function formatCommandSection(label: string, result: PromiseSettledResult<UsageSnapshot>): string {
  if (result.status === "fulfilled") return formatUsageReport(result.value);
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return `${label}\n  unavailable: ${message}`;
}

function colorForSeverity(severity: "ok" | "warning" | "critical"): { background: string; foreground: string } {
  if (severity === "critical") return { background: "toolErrorBg", foreground: "error" };
  if (severity === "warning") return { background: "toolPendingBg", foreground: "warning" };
  return { background: "toolSuccessBg", foreground: "success" };
}
