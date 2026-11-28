import { Flag } from "../schema.ts";
import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "rws-petten-meetraai3-2012-zero",
  "rws-petten-meetraai3-2013-march-zero",
  "rws-petten-meetraai3-2013-april-zero",
];

const STATIONS = ["rws/petten.meetraai3", "gesla/petten_meetraai_03-pet-nld-rws"];
// Between and after the errata's spans, where the old single span's flags must be gone.
const RELEASED = [
  ["2012-12-14", "2013-03-08"],
  ["2013-03-10", "2013-04-14"],
  ["2013-05-04", "2013-05-16"],
] as const;

export default {
  description: "Flag Petten meetraai 03 only where it's faulty",
  steps: [
    { ingest: "requalify rws petten.meetraai3 2012 2014" },
    { ingest: "requalify gesla petten_meetraai_03-pet-nld-rws 2012 2014" },
    { ingest: "publish" },
    {
      check: "the three Petten errata read back, and the values between them are released",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const id of IDS) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          await e.check(reader, e);
        }
        // QC's own rules flag a few percent here; the old span flagged every value.
        const spread = (rows: { level: number }[]) => {
          const mean = rows.reduce((a, b) => a + b.level, 0) / rows.length;
          return Math.sqrt(rows.reduce((a, b) => a + (b.level - mean) ** 2, 0) / rows.length);
        };
        const hourly = (rows: { time: number; level: number }[]) => {
          const hours = new Map<number, number[]>();
          for (const o of rows) {
            const h = Math.floor(o.time / 3_600_000);
            hours.set(h, [...(hours.get(h) ?? []), o.level]);
          }
          return [...hours].map(
            ([h, v]) => [h, v.reduce((a, b) => a + b, 0) / v.length] as [number, number],
          );
        };
        for (const [since, until] of RELEASED) {
          const control = await reader.levels("rws/ijmuiden.buitenhaven", since, until);
          for (const station of STATIONS) {
            const rows = await reader.levels(station, since, until);
            const where = `${station} from ${since} to ${until}`;
            if (rows.length < 300 || control.length < 300)
              throw new Error(
                `too few levels to judge ${where}: ${rows.length}, with ${control.length} at IJmuiden`,
              );
            const suspect = rows.filter((o) => o.flag >= Flag.suspect).length;
            if (suspect > rows.length / 5)
              throw new Error(`${suspect} of ${rows.length} levels of ${where} are suspect`);
            const ratio = spread(rows) / spread(control);
            if (!(ratio > 0.75 && ratio < 1.3))
              throw new Error(`${where} spreads ${ratio.toFixed(2)} times as far as IJmuiden`);
            const at = new Map(hourly(control));
            const gaps = hourly(rows).flatMap(([h, v]) => (at.has(h) ? [v - at.get(h)!] : []));
            const offset = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            if (!(Math.abs(offset) < 0.08))
              throw new Error(`${where} sits ${offset.toFixed(2)} m from IJmuiden`);
            const zeros = new Map<number, number>();
            for (const o of rows)
              if (o.level === 0) {
                const day = Math.floor(o.time / 86_400_000);
                zeros.set(day, (zeros.get(day) ?? 0) + 1);
              }
            if (Math.max(0, ...zeros.values()) > 5)
              throw new Error(`${where} holds a day with more than 5 values of 0.00 m`);
          }
        }
      },
    },
  ],
} satisfies Migration;
