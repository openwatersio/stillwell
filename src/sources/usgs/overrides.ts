import type { Overrides } from "../../schema.ts";

/**
 * USGS dated none of these ten gages' changes, so the refresh of 2026-11-16 14:19:07 UTC opened epoch 2 and epoch 1
 * ended at its last `seen`, 2026-11-05 14:12, which left the readings between outside both spans (#525). Each
 * decision rests on the current series' readings in the Water Data API's `continuous` against the readings stored
 * for each epoch, and on the step in gage height from one reading to the next, since a moved zero shows as a step
 * the water doesn't make.
 */
export const overrides: Overrides = {
  epochs: {
    "usgs/08098295 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS replaced series beb9a600 with cf10b3ee. The current series returns the stored epoch 1 readings at all 2,557 times, and the stored epoch 2 readings at all 403, to 0.1 mm, so the series ID changed and the zero didn't. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/08111056 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS replaced series b4ba80eb with cda30b54. The current series returns the stored epoch 1 readings at all 1,897 times, and the stored epoch 2 readings at all 404, to 0.1 mm, so the series ID changed and the zero didn't. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/08111070 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS replaced series 3473a115 with 2c08b63f. The current series returns the stored epoch 2 readings at all 404 times to 0.1 mm, and the stored epoch 1 readings at all 3,298 times from 2026-11-01 less 0.0061 m (0.02 ft), which also holds in the three-day windows read from 1 and 20 July, 10 and 25 August and the week from 1 September, and not in those from 1 May and 1 June (October wasn't read): USGS revised the provisional readings by that much, which a refetch of this year takes in. Neither boundary has a step, so the zero didn't move. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/08117857 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS replaced series 0da938db with 0421fe45. The current series returns the stored epoch 1 readings at all 2,871 times, and the stored epoch 2 readings at all 404, to 0.1 mm, so the series ID changed and the zero didn't. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/08117858 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS replaced series ba4c3dbf with 8239ab9a. The current series returns the stored epoch 1 readings at all 3,097 times, and the stored epoch 2 readings at all 404, to 0.1 mm, so the series ID changed and the zero didn't. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/09510200 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS lists two primary series for the site from 2007, 8b0c32f9 and 36860ca7, with the same readings, and the refresh moved from one to the other. The current 36860ca7 returns the stored epoch 1 readings at all 1,617 times, and the stored epoch 2 readings at all 134, to 0.1 mm, so the series ID changed and the zero didn't. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19 (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/06207500 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS now lists the gage datum at 3,984.66 ft NAVD88 (surveyed, ±0.13 ft), not 1,215.006 m NGVD29, which VERTCON 3.0 puts at 1,216.026 m NAVD88, 1.502 m higher. The gage height has no step larger than 0.0061 m from one reading to the next across 2026-11-05 to 11-17, and the current series returns the stored epoch 1 readings at all 1,489 times, and the stored epoch 2 readings at all 134, to 0.1 mm, so the zero didn't move: USGS restated its altitude. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19, and every reading reads against the new altitude, as a restated altitude requires (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/09505400 2026-11-16T14:19:07Z": {
      reject: true,
      note: "USGS now lists the gage datum at 972.416 m NAVD88 (3,190.34 ft, GNSS level 2, ±0.08 ft), not 972.312 m. The gage height has no step larger than 0.0092 m from one reading to the next across 2026-11-05 to 11-17, and the current series returns the stored epoch 1 readings at all 1,497 times, and the stored epoch 2 readings at all 134, to 0.1 mm, so the zero didn't move: USGS restated its altitude. Rejected, so epoch 1 holds the readings from 2026-11-05 14:12 to 11-16 14:19, and every reading reads against the new altitude, as a restated altitude requires (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/09505800 2026-11-16T14:19:07Z": {
      since: "2026-11-10T22:45:00Z",
      note: "USGS lists a new series, f53bfd4e, whose gage height and discharge both start at 22:45 UTC on 2026-11-10, and now lists the gage datum at 3,627.35 ft NAVD88 (GNSS level 2, ±0.25 ft), not 1,106.424 m NGVD29, which VERTCON 3.0 puts at 1,107.189 m NAVD88, 1.573 m higher. The gage height steps from −0.165 m at 22:30 to −0.631 m at 22:45, at 35.8 cfs, and the stored readings after the step equal the new series' at all 314 times it covers, so the reference began at 22:45. The altitudes alone don't say the zero moved: the old one, converted, sits 1.573 m above the new one, a restatement of the size USGS made at 06207500, and the step is 0.466 m, so epoch 1 stays unconverted. Epoch 1 holds until then, and the readings from there to 2026-11-16 14:19 belong to epoch 2, once a backfill of the station from 2026-11-10 22:45 has written them into its files (#525, erratum `usgs-undated-gage-changes`).",
    },
    "usgs/07263883 2026-11-16T14:19:07Z": {
      since: "2026-11-08T20:16:00Z",
      note: "USGS lists the site's HEADWATER series, 5f0ae99f, which ends at 20:15 UTC on 2026-11-08, and its TAILWATER series, 54c778a6, which ends on 2026-10-02. The refresh moved to the tailwater only because neither reports, so the choice was a tie. The stored epoch 1 readings from 2026-11-03 23:00 to 11-08 20:15 equal the headwater series at all 376 times. Not rejected, since the tailwater is another water level, which a backfill would write into epoch 1. Epoch 1 holds until the headwater's last reading, and epoch 2, the tailwater, has no readings. When the headwater reports again the refresh holds the change back for a decision, since it falls within 180 days (#525, erratum `usgs-undated-gage-changes`).",
    },
  },
};
