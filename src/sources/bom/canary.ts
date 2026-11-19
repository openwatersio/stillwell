/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as bom from "./index.ts";

export const probes: Probes = {
  // Cape Ferguson's June of last year, from last year's archive, which is whole
  // all year; the current year's runs weeks behind. The FTP's files are text, so
  // it's never recorded and only has to return values.
  bom: {
    run: (start, end) =>
      bom.levels(
        "995",
        new Date(Date.UTC(end.getUTCFullYear() - 1, 5, 1)),
        new Date(Date.UTC(end.getUTCFullYear() - 1, 5, 4)),
      ),
    recorded: false,
  },
};
