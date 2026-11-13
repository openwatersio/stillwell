import { seconds, type PassResult } from "./schedule.ts";

/** What the poller reports of one source's passes. */
export interface SourceMetrics {
  /** When the last pass ended, whatever its result, in ms. */
  lastEnd: number;
  /**
   * When the last successful pass ended, in ms: one that ran to the end, unblocked, and stored new values
   * for some station. The poller keeps it across restarts (`readSaved`).
   */
  lastSuccess?: number;
  /** Passes that weren't successful, since the poller started. */
  failures: number;
  /** The source's shortest group interval in seconds, hourly until a pass has read its list. */
  interval: number;
  /** Stations the last successful pass found stale, and its failures, of stations or of other steps. */
  stale: number;
  failed: number;
}

/**
 * A source's metrics when the poller starts: its last success and interval from
 * the file it wrote before, or the start and hourly for a source it has none
 * for, so one that never succeeds still ages into the stale-source alert.
 */
export function startMetrics(
  now: number,
  saved: { lastSuccess?: number; interval?: number } = {},
): SourceMetrics {
  return {
    lastEnd: now,
    lastSuccess: saved.lastSuccess ?? now,
    failures: 0,
    interval: saved.interval ?? seconds(0),
    stale: 0,
    failed: 0,
  };
}

/** Each source's last success, in ms, and interval, from a metrics file `metricsText` wrote. */
export function readSaved(text: string): Map<string, { lastSuccess?: number; interval?: number }> {
  const found = new Map<string, { lastSuccess?: number; interval?: number }>();
  for (const [, name, source, value] of text.matchAll(
    /^stillwell_(pass_last_success_timestamp_seconds|poll_interval_seconds)\{source="([^"]+)"\} ([0-9.]+)$/gm,
  )) {
    const saved = found.get(source!) ?? {};
    if (name === "poll_interval_seconds") saved.interval = Number(value);
    else saved.lastSuccess = Number(value) * 1000;
    found.set(source!, saved);
  }
  return found;
}

/** A source's metrics after a pass that ended at `now`, with `result`, or with none when it failed. */
export function recordPass(
  previous: SourceMetrics | undefined,
  now: number,
  result: PassResult | null,
): SourceMetrics {
  const next: SourceMetrics = { ...(previous ?? startMetrics(now)), lastEnd: now };
  if (!previous) delete next.lastSuccess;
  if (result?.intervals.length) next.interval = Math.min(...result.intervals.map(seconds));
  const summary = result?.summary;
  // Success is new values reaching ClickHouse, or a source with nothing to poll, such as one waiting for its
  // first list: a pass that polled stations and heard nothing new isn't one.
  const idle = !!result?.ok && !result.intervals.length;
  if (idle || (result?.ok && summary && !summary.blocked && summary.updated > 0)) {
    next.lastSuccess = now;
    next.stale = summary?.stale.length ?? 0;
    next.failed = summary?.failed.length ?? 0;
  } else next.failures++;
  return next;
}

/** The metrics in Prometheus's text format, for Alloy's textfile collector. */
export function metricsText(sources: Map<string, SourceMetrics>): string {
  const series: [string, string, string, (m: SourceMetrics) => number | undefined][] = [
    [
      "stillwell_pass_last_end_timestamp_seconds",
      "gauge",
      "When the last pass ended.",
      (m) => m.lastEnd / 1000,
    ],
    [
      "stillwell_pass_last_success_timestamp_seconds",
      "gauge",
      "When the last pass that ran to the end, unblocked, and stored new values, ended.",
      (m) => (m.lastSuccess === undefined ? undefined : m.lastSuccess / 1000),
    ],
    [
      "stillwell_pass_failures_total",
      "counter",
      "Passes that failed, were stopped, were blocked, or stored no new values.",
      (m) => m.failures,
    ],
    [
      "stillwell_poll_interval_seconds",
      "gauge",
      "The source's shortest group interval.",
      (m) => m.interval,
    ],
    [
      "stillwell_stale_stations",
      "gauge",
      "Stations the last successful pass found stale.",
      (m) => m.stale,
    ],
    [
      "stillwell_failed_stations",
      "gauge",
      "Failures the last successful pass reported.",
      (m) => m.failed,
    ],
  ];
  const lines: string[] = [];
  for (const [name, type, help, value] of series) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [source, m] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
      const v = value(m);
      if (v !== undefined) lines.push(`${name}{source="${source}"} ${v}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
