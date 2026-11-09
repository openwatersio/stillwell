/**
 * GESLA records whose values are another gauge's, by file name. The adapter
 * lists each inactive, with no products or links, and refuses to fetch it,
 * and no link joins it to a group (src/same-as.ts). Uddevalla's holds Arkö's
 * values, row for row (erratum `gesla-uddevalla-is-arko`).
 */
export const DROPPED = new Set(["uddevalla-2541-swe-smhi"]);
