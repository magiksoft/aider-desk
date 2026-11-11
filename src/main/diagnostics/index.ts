import { performance } from 'node:perf_hooks';

import { DIAGNOSTICS_MODE } from '@/constants';
import logger from '@/logger';

/**
 * Opt-in runtime diagnostics for investigating concurrency-related stalls
 * (see GitHub discussion #992). Everything here is a no-op unless the app is
 * started with AIDER_DESK_DIAGNOSTICS=true, so there is no behavior or
 * performance impact in normal operation.
 */

export const isDiagnosticsEnabled = (): boolean => DIAGNOSTICS_MODE;

// --- Event loop lag monitor -------------------------------------------------

let monitorTimer: NodeJS.Timeout | null = null;

/**
 * Starts a timer that measures how late it fires relative to its scheduled
 * interval. The delta is event-loop lag: time the single main thread spent
 * blocked (synchronous work, fsync, large serialization) and therefore unable
 * to process IPC, UI events, or other agents' streams.
 */
export const startEventLoopMonitor = (intervalMs = 500, lagThresholdMs = 100): void => {
  if (!DIAGNOSTICS_MODE || monitorTimer) {
    return;
  }

  let last = performance.now();
  monitorTimer = setInterval(() => {
    const now = performance.now();
    const lag = now - last - intervalMs;
    last = now;
    if (lag > lagThresholdMs) {
      logger.warn('[Diagnostics] Event loop lag detected', { lagMs: Math.round(lag) });
    }
  }, intervalMs);
  monitorTimer.unref?.();

  logger.info('[Diagnostics] Event loop monitor started', { intervalMs, lagThresholdMs });
};

export const stopEventLoopMonitor = (): void => {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
};

// --- DB write metrics -------------------------------------------------------

type WriteBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  totalBytes: number;
  maxBytes: number;
};

const SLOW_WRITE_THRESHOLD_MS = 20;
const REPORT_INTERVAL_MS = 10000;

const buckets = new Map<string, WriteBucket>();
let lastReportAt = 0;

const flushReport = (): void => {
  if (buckets.size === 0) {
    return;
  }
  const summary: Record<string, unknown> = {};
  for (const [label, bucket] of buckets) {
    summary[label] = {
      count: bucket.count,
      avgMs: Math.round((bucket.totalMs / bucket.count) * 10) / 10,
      maxMs: Math.round(bucket.maxMs),
      avgKb: Math.round(bucket.totalBytes / bucket.count / 1024),
      maxKb: Math.round(bucket.maxBytes / 1024),
    };
  }
  logger.info('[Diagnostics] DB write metrics (last window)', summary);
  buckets.clear();
};

/**
 * Records a single synchronous DB write (duration + serialized size), bucketed
 * by label. Individually slow writes are logged immediately; aggregates are
 * reported every REPORT_INTERVAL_MS to quantify write frequency and size
 * growth under load without flooding the log.
 */
export const recordDbWrite = (label: string, bytes: number, durationMs: number): void => {
  if (!DIAGNOSTICS_MODE) {
    return;
  }

  const bucket = buckets.get(label) ?? { count: 0, totalMs: 0, maxMs: 0, totalBytes: 0, maxBytes: 0 };
  bucket.count += 1;
  bucket.totalMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  bucket.totalBytes += bytes;
  bucket.maxBytes = Math.max(bucket.maxBytes, bytes);
  buckets.set(label, bucket);

  if (durationMs >= SLOW_WRITE_THRESHOLD_MS) {
    logger.warn('[Diagnostics] Slow DB write', { label, durationMs: Math.round(durationMs), kb: Math.round(bytes / 1024) });
  }

  const now = Date.now();
  if (lastReportAt === 0) {
    lastReportAt = now;
  } else if (now - lastReportAt >= REPORT_INTERVAL_MS) {
    lastReportAt = now;
    flushReport();
  }
};
