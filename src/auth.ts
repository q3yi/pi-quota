import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_PI_AUTH_PATH = ".pi/agent/auth.json";

export interface CodexAuthConfig {
  type?: "oauth";
  access: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

interface PiAuthConfig {
  "openai-codex"?: CodexAuthConfig;
}

export function getPiAuthFilePath(): string {
  return process.env.PI_AUTH_DIR
    ? path.join(process.env.PI_AUTH_DIR, "auth.json")
    : path.join(os.homedir(), DEFAULT_PI_AUTH_PATH);
}

export function getCodexAuth(): CodexAuthConfig {
  const authFilePath = getPiAuthFilePath();
  try {
    const auth = JSON.parse(fs.readFileSync(authFilePath, "utf-8")) as PiAuthConfig;
    const codex = auth["openai-codex"];
    if (!codex?.access) throw new Error("openai-codex OAuth access token not found in auth.json");
    return codex;
  } catch (error) {
    if (error instanceof Error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Pi auth file not found at ${authFilePath}. Run /login openai-codex first.`);
      }
      throw new Error(`Failed to read Codex auth: ${error.message}`);
    }
    throw new Error("Failed to read Codex auth: unknown error");
  }
}
