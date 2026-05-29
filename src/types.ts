export type UsageProvider = "codex" | "opencode-go";
export type ResetStyle = "relative" | "weekday" | "date";
export type UsageSeverity = "ok" | "warning" | "critical";

export interface UsageLimitView {
  label: string;
  percentage: number;
  nextResetTime: number;
  resetStyle: ResetStyle;
}

export interface UsageSnapshot {
  provider: UsageProvider;
  label: string;
  planLabel?: string;
  limits: UsageLimitView[];
}

export interface UsageStatusSegment {
  text: string;
  usedPercentage: number;
  severity: UsageSeverity;
}

export interface ModelContext {
  provider?: string | null;
  id?: string;
  model?: string;
}

export function selectUsageProvider(model?: ModelContext | null): UsageProvider | null {
  if (model?.provider === "openai-codex") return "codex";
  if (model?.provider === "opencode-go") return "opencode-go";
  return null;
}
