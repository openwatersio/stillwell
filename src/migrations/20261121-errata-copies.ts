import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// The errata this change merges, moves or lists copies in.
const IDS = [
  "cmems-buesum-spikes",
  "cmems-holyhead-2026-april-erratic",
  "cmems-holyhead-2026-erratic",
  "cmems-kilrush-2025-01-09-offset",
  "coops-boston-light-2001-offset",
  "coops-burlington-2002-datum",
  "linz-boat-cove-sensor-fault-2013",
  "linz-devonport-sensor-fault-2012",
  "linz-korotiti-bay-sensors",
  "linz-napier-sensor-fault-2010-12",
  "linz-scott-base-steps-2019-01",
  "linz-scott-base-unreliable-2021",
  "marine-institute-castletownbere-2026-offsets",
  "marine-institute-dublin-port-2020-offset",
  "marine-institute-kilrush-2024-offset",
  "marine-institute-kilrush-2025-01-09-offset",
  "marine-institute-kilrush-2025-08-09-offset",
  "marine-institute-kilrush-2025-08-offsets",
  "marine-institute-kilrush-2025-offsets",
  "marine-institute-malin-head-2026-may-offset",
  "marine-institute-malin-head-2026-offset",
  "marine-institute-sligo-2026-offset",
  "pegelonline-bake-z-2002-offset",
  "pegelonline-bake-z-2004-offset",
  "pegelonline-borkum-suedstrand-2014-offset",
  "pegelonline-helgoland-binnenhafen-2000-offset",
  "pegelonline-helgoland-suedhafen-2001-offset",
  "pegelonline-helgoland-suedhafen-2013-clock",
  "pegelonline-mittelgrund-2012-offset",
  "pegelonline-schillig-2006-offset",
  "refmar-pointe-a-pitre-clock",
  "rws-eemshaven-waddenzee-2016-offset",
  "rws-petten-meetraai3-2012-zero",
  "smhi-eriksberg-2018-tingstadstunneln",
  "uhslc-cuxhaven-2024-march",
  "uhslc-cuxhaven-2024-summer",
  "uhslc-goteborg-2007-hour-early",
  "uhslc-goteborg-2011-hour-early",
  "uhslc-inhambane-2012-datum",
];

// The copies newly listed take their original's span, which a requalify applies to the values the store holds.
export default {
  description: "Flag errata spans in other sources' copies of the same records",
  steps: [
    {
      ingest:
        "requalify gesla holyhead-hol-gbr-cmems,castletownbere_port-cas-irl-mi_c,malin_head_portmore_pier-mal-irl-mi_c 2026 2027",
    },
    { ingest: "requalify gesla kilrush_lough-kil-irl-mi_c 2024 2026" },
    { ingest: "requalify gesla boston_light-8444162-usa-noaa 2001 2002" },
    { ingest: "requalify gesla burlington-8539094-usa-noaa 1840 2003" },
    { ingest: "requalify gesla inhambane-900a-moz-uhslc_rq 1840 2013" },
    { ingest: "requalify gesla korotiti_bay-gbit-nzl-ttw 2021 2025" },
    { ingest: "requalify gesla auckland-auct-nzl-ttw 2012 2013" },
    { ingest: "requalify gesla boat_cove-rbct-nzl-ttw 2013 2014" },
    { ingest: "requalify gesla napier-napt-nzl-ttw 2010 2011" },
    { ingest: "requalify gesla scott_base_antarctica-scot-nzl-ttw 2019 2022" },
    { ingest: "requalify gesla dublin_port-dub-irl-mi_c 2020 2021" },
    { ingest: "requalify gesla helgolandtg-hel-deu-cmems 1840 2014" },
    { ingest: "requalify gesla schillig-9430030-deu-wsv 2006 2007" },
    { ingest: "requalify gesla bakez-9510066-deu-wsv 2002 2003" },
    {
      ingest:
        "requalify gesla pointe_a_pitre-125-fra-refmar,pointeapitretg_60minute-poi-fra-cmems 2020 2025",
    },
    { ingest: "requalify cmems BuesumTG 2024 2026" },
    { ingest: "requalify cmems KilrushLough 2025 2026" },
    { ingest: "requalify cmems MalinHead,Sligo 2026 2027" },
    { ingest: "requalify cmems HelgolandTG 1840 2014" },
    { ingest: "requalify cmems HelgolandBinnenhafenTG 1840 2001" },
    { ingest: "requalify cmems PointeAPitreTG 2020 2025" },
    { ingest: "requalify rws eemshaven.waddenzee 2016 2017" },
    { ingest: "publish" },
    {
      check: "each erratum this change touches reads back from the store",
      timeout: 120,
      async verify(store) {
        const reader = errataReader(() => store, store);
        const copied = IDS.map((id) => {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          return e;
        });
        const failed = (
          await Promise.all(
            copied.map((e) =>
              e.check!(reader, e).then(
                () => null,
                (error: Error) => `${e.id}: ${error.message}`,
              ),
            ),
          )
        ).filter(Boolean);
        if (failed.length) throw new Error(failed.join("\n"));
      },
    },
  ],
} satisfies Migration;
