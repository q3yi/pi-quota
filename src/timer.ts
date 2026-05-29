export interface PeriodicRefreshController {
  start: (intervalMs?: number) => void;
  stop: () => void;
  isRunning: () => boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;

export function createPeriodicRefresh(refresh: () => Promise<void>): PeriodicRefreshController {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let tickInProgress = false;

  async function tick(): Promise<void> {
    if (tickInProgress) return;
    tickInProgress = true;
    try {
      await refresh();
    } finally {
      tickInProgress = false;
    }
  }

  return {
    start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
      if (intervalId !== null) return;
      void tick();
      intervalId = setInterval(tick, intervalMs);
    },
    stop(): void {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
      tickInProgress = false;
    },
    isRunning(): boolean {
      return intervalId !== null;
    },
  };
}
