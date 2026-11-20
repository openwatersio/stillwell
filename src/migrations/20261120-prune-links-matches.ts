import { readLinks } from "../links.ts";
import { readMatches, withoutGone } from "../matches.ts";
import { sources } from "../sources/index.ts";
import { readStationList } from "../store/parquet.ts";
import { stationListPath } from "../store/paths.ts";
import { storeOfSource } from "../store/stores.ts";
import { withheldReason } from "../withhold.ts";
import type { StoredStation } from "../schema.ts";
import type { Migration } from "../jobs/migrations.ts";

// Half of what each held on 2026-11-20, 23,531 and 4,601 rows, none naming a withheld or dropped station: a file under
// this was emptied or cut short, which an ordinary month's change won't do.
const FLOOR = { matches: 11_700, links: 2_300 };

// `matches --prune` and `links --prune` take out the rows naming a withheld or dropped station, as the Ingest workflow
// now runs them after each `withhold` and `drop`. The public files held none when this was written, so this proves the
// commands on the store and leaves both files unchanged.
export default {
  description: "Take withheld and dropped stations out of the link and match files",
  steps: [
    { ingest: "matches --prune", timeout: 30 },
    { ingest: "links --prune", timeout: 30 },
    {
      check: "no row of either file names a withheld or dropped station, and neither file is short",
      async verify(store) {
        const listed: StoredStation[] = [];
        for (const source of Object.values(sources)) {
          let home: string;
          try {
            home = storeOfSource(source.metadata);
          } catch {
            continue;
          }
          if (home !== store) continue;
          const list = await readStationList(stationListPath(store, source.metadata.id));
          // A dropped GESLA record is known only through GESLA's list.
          if (list) listed.push(...list);
          else if (source.metadata.id === "gesla") throw new Error(`${store}: no list for gesla`);
        }
        const shown = (id: string) => {
          const source = sources[id.split("/")[0]!];
          return !source || withheldReason(source, id) === null;
        };
        const files: [keyof typeof FLOOR, { a: string; b: string }[]][] = [
          ["matches", await readMatches(store)],
          ["links", await readLinks(store)],
        ];
        for (const [name, rows] of files) {
          if (rows.length < FLOOR[name])
            throw new Error(`${name}: ${rows.length} rows, under ${FLOOR[name]}`);
          const gone = rows.length - withoutGone(rows, listed, shown).length;
          if (gone) throw new Error(`${name}: ${gone} rows name a withheld or dropped station`);
        }
      },
    },
  ],
} satisfies Migration;
