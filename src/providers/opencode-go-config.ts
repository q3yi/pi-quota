import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface OpenCodeGoConfig {
  workspaceId: string;
  authCookie: string;
}

export type ResolvedOpenCodeGoConfig =
  | { state: "configured"; config: OpenCodeGoConfig; source: string }
  | { state: "incomplete"; source: string; missing: string }
  | { state: "invalid"; source: string; error: string }
  | { state: "none"; checkedPaths: string[] };

export function getOpenCodeGoConfigCandidatePaths(): string[] {
  return [path.join(os.homedir(), ".pi", "pi-quota", "opencode-go.json")];
}

export function resolveOpenCodeGoConfigFromEnv(env = process.env): ResolvedOpenCodeGoConfig | null {
  const workspaceId = env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const authCookie = env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (!workspaceId && !authCookie) return null;
  if (workspaceId && authCookie) return { state: "configured", config: { workspaceId, authCookie }, source: "env" };
  return {
    state: "incomplete",
    source: "env",
    missing: workspaceId ? "OPENCODE_GO_AUTH_COOKIE" : "OPENCODE_GO_WORKSPACE_ID",
  };
}

export async function resolveOpenCodeGoConfig(): Promise<ResolvedOpenCodeGoConfig> {
  const env = resolveOpenCodeGoConfigFromEnv();
  if (env) return env;

  const checkedPaths = getOpenCodeGoConfigCandidatePaths();
  for (const candidate of checkedPaths) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf-8")) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { state: "invalid", source: candidate, error: "Config file must contain a JSON object" };
      }
      const workspaceId = typeof parsed.workspaceId === "string" ? parsed.workspaceId.trim() : "";
      const authCookie = typeof parsed.authCookie === "string" ? parsed.authCookie.trim() : "";
      if (workspaceId && authCookie) return { state: "configured", config: { workspaceId, authCookie }, source: candidate };
      return { state: "incomplete", source: candidate, missing: workspaceId ? "authCookie" : "workspaceId" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      const message = error instanceof Error ? error.message : String(error);
      return { state: "invalid", source: candidate, error: message };
    }
  }

  return { state: "none", checkedPaths };
}

let cached: ResolvedOpenCodeGoConfig | null = null;
let cachedAt = 0;
const DEFAULT_CACHE_MAX_AGE_MS = 30_000;

export async function resolveOpenCodeGoConfigCached(maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS): Promise<ResolvedOpenCodeGoConfig> {
  const now = Date.now();
  if (cached && now - cachedAt < maxAgeMs) return cached;
  cached = await resolveOpenCodeGoConfig();
  cachedAt = now;
  return cached;
}
