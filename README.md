# pi-quota

Pi extension that shows coding-plan quota usage in the status bar.

Supported providers:

- `openai-codex` — uses Pi's Codex OAuth auth from `/login openai-codex`.
- `opencode-go` — scrapes the OpenCode Go dashboard quota windows.

## Install / test

```bash
deno task typecheck

pi -e ./extensions/pi-quota.ts
# or
pi install /path/to/pi-quota
```

## OpenAI Codex setup

Log in inside Pi:

```text
/login openai-codex
```

The extension reads `~/.pi/agent/auth.json` or `$PI_AUTH_DIR/auth.json`, and asks Pi's model registry to refresh the token when possible.

## OpenCode Go setup

Set environment variables:

```bash
export OPENCODE_GO_WORKSPACE_ID="your-workspace-id"
export OPENCODE_GO_AUTH_COOKIE="your-opencode-ai-auth-cookie"
```

Alternatively create:

```text
~/.pi/pi-quota/opencode-go.json
```

```json
{
  "workspaceId": "your-workspace-id",
  "authCookie": "your-opencode-ai-auth-cookie"
}
```

## Display

Example status shows remaining quota:

```text
5h 58% left ↻ 2h15 · 1w 32% left ↻ Mon
```

Use `/quota` to show both Codex and OpenCode Go usage details with progress bars.

