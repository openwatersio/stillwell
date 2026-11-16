import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import type { Job } from "./queue.ts";

/** How a job's run ended, or null while it runs. */
export type Ended = { ok: boolean; result: string } | null;

/** Where jobs run: systemd units on the box, behind this so tests can stand in. */
export interface Units {
  start(job: Job, release: string): void;
  ended(id: number): Ended;
  /**
   * Stops a job's unit if it runs, and once it reads as stopped or gone, removes it and the job's
   * directory. False when it can't confirm the unit stopped, so the caller keeps the job's lane.
   */
  clear(id: number): boolean;
}

export const unitOf = (id: number) => `stillwell-job-${id}`;

/**
 * Each job's working directory, which holds its response cache and DuckDB's spill, deleted when it ends.
 * Under the service's own root-owned directory, so the stillwell user can't move what root removes.
 */
export const jobDir = (id: number) => `/var/lib/stillwell-jobs/runs/${id}`;

function systemctl(...args: string[]): string {
  // Its errors come back in the throw; on the service's stderr they'd only repeat in the journal.
  return execFileSync("systemctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Node as the units start it, through the link deploys move, so a later deploy's cleanup never removes it. */
export const NODE = "/opt/node/bin/node";

/**
 * The `systemd-run` arguments that start a job from `release`, as the stillwell user, allowed `memory` bytes,
 * reading /etc/stillwell.env as the poller does. Its own variables, `store` as STILLWELL_STORE among them, go
 * through `env` on its command, since systemd lets a unit's EnvironmentFile override its Environment.
 */
export function runArgs(job: Job, release: string, store: string, memory: number): string[] {
  const env = {
    STILLWELL_STORE: store,
    // V8's heap under the cap, leaving the rest to DuckDB, as Actions sets it for compaction.
    NODE_OPTIONS: `--max-old-space-size=${Math.floor((memory * 0.6) / 2 ** 20)}`,
    // scripts/monthly.sh's requalify and analysis, whose workers each take at least 1 GB, within the cap.
    STILLWELL_CONCURRENCY: String(Math.max(1, Math.floor(memory / 2 ** 30 / 1.5))),
    // DuckDB keeps its extensions under HOME, the poller's state directory.
    HOME: "/var/lib/stillwell",
    STILLWELL_CACHE: `${jobDir(job.id)}/cache`,
    // A shell script, such as scripts/monthly.sh, runs node itself.
    PATH: `${dirname(NODE)}:/usr/bin:/bin`,
  };
  return [
    `--unit=${unitOf(job.id)}`,
    `--description=Stillwell job ${job.id}: ${job.command.join(" ")}`,
    "--uid=stillwell",
    "--gid=stillwell",
    // The unit stays, with its result, once the job exits, so a restart of the service still reads it.
    "--property=RemainAfterExit=yes",
    `--property=RuntimeMaxSec=${job.timeout * 60}`,
    `--property=MemoryMax=${memory}`,
    // Below the poller's default weight, so a busy job never holds up its passes.
    "--property=CPUWeight=50",
    "--property=EnvironmentFile=/etc/stillwell.env",
    `--property=WorkingDirectory=${jobDir(job.id)}`,
    "--property=NoNewPrivileges=yes",
    "--property=ProtectSystem=strict",
    "--property=ProtectHome=yes",
    "--property=PrivateTmp=yes",
    `--property=ReadWritePaths=/var/lib/stillwell ${jobDir(job.id)}`,
    "/usr/bin/env",
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    job.command[0].endsWith(".sh") ? "/bin/bash" : NODE,
    `${release}/${job.command[0]}`,
    ...job.command.slice(1),
  ];
}

/** Jobs as transient systemd units, each allowed `memory` bytes, writing `store`. */
export function systemd(store: string, memory = 0): Units {
  return {
    start(job, release) {
      execFileSync("install", ["-d", "-m", "755", dirname(jobDir(job.id))]);
      execFileSync("install", ["-d", "-o", "stillwell", "-g", "stillwell", jobDir(job.id)]);
      execFileSync("systemd-run", runArgs(job, release, store, memory));
    },
    ended(id) {
      try {
        return endedFrom(
          systemctl(
            "show",
            unitOf(id),
            "-p",
            "LoadState,ActiveState,SubState,Result,ExecMainStatus",
          ),
        );
      } catch (error) {
        // A failed read, such as a D-Bus timeout, says nothing about the job, so it's read again next tick.
        console.error(`job ${id}: can't read its unit: ${(error as Error).message}`);
        return null;
      }
    },
    clear(id) {
      let stopError = "";
      try {
        systemctl("stop", unitOf(id));
      } catch (error) {
        // A unit that's gone can't be stopped; one that is still there is reported below with why.
        stopError = (error as Error).message;
      }
      let state: string;
      try {
        state = systemctl("show", unitOf(id), "-p", "LoadState,ActiveState");
      } catch (error) {
        console.error(
          `job ${id}: can't read its unit after stopping it: ${(error as Error).message}`,
        );
        return false;
      }
      if (!/LoadState=not-found|ActiveState=(inactive|failed)/.test(state)) {
        console.error(`job ${id}: still running after a stop${stopError ? `: ${stopError}` : ""}`);
        return false;
      }
      try {
        systemctl("reset-failed", unitOf(id));
      } catch {
        // Only a failed unit has anything to reset.
      }
      execFileSync("rm", ["-rf", jobDir(id)]);
      return true;
    },
  };
}

/** How a job's unit ended, from `systemctl show`'s properties, or null while it runs or stops. */
export function endedFrom(show: string): Ended {
  const props = Object.fromEntries(
    show
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  if (props.LoadState === "not-found") return { ok: false, result: "its unit is gone" };
  // RemainAfterExit keeps a unit whose process exited 0 active, with SubState exited, and one that failed failed.
  if (props.ActiveState === "active" && props.SubState === "exited")
    return props.Result === "success" && props.ExecMainStatus === "0"
      ? { ok: true, result: "exit 0" }
      : { ok: false, result: `${props.Result}, exit ${props.ExecMainStatus}` };
  if (props.ActiveState === "failed")
    return {
      ok: false,
      result:
        props.Result === "timeout"
          ? "stopped at its timeout"
          : `${props.Result}, exit ${props.ExecMainStatus}`,
    };
  if (props.ActiveState === "inactive") return { ok: false, result: "stopped" };
  return null;
}
