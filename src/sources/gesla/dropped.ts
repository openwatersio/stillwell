/**
 * GESLA records whose values are another gauge's, by file name, besides the
 * CRMS records `isDropped` finds by rule. Uddevalla's holds Arkö's values, row
 * for row (erratum `gesla-uddevalla-is-arko`).
 */
export const DROPPED = new Set(["uddevalla-2541-swe-smhi"]);

/**
 * GESLA's copies of 40 CRMS gauges, by site, are an hour early. Erratum
 * `gesla-crms-hour-early`, whose stations a test keeps equal to this list.
 */
export const CRMS_EARLY = new Set(
  `
  0002 0003 0006 0008 0030 0033 0034 0035 0038 0039
  0046 0047 0056 0058 0059 0061 0063 0065 0086 0089
  0097 0103 0108 0114 0115 0117 0118 0119 0120 0121
  0125 0129 0131 0132 0135 0136 0139 0146 0147 0148
`
    .trim()
    .split(/\s+/)
    .map((site) => `crms${site}-crms${site}-usa-crms`),
);

/**
 * GESLA's CRMS records that are the site's marsh well throughout, so they
 * share no gauge with the site's surface-water series (erratum
 * `gesla-crms0090-marsh-well`, erratum `gesla-crms0128-marsh-well`).
 */
export const CRMS_WELLS = new Set(["CRMS0090", "CRMS0128"]);

const CRMS = /^crms(\d{4})-crms\1-usa-crms$/;

/**
 * Whether GESLA's record `file` holds another gauge's values. The adapter
 * lists each such record inactive, with no products or links, and refuses to
 * fetch it, and no link joins it to a group (src/same-as.ts). Of GESLA's CRMS
 * records only those in `CRMS_EARLY` and `CRMS_WELLS` hold their own site's
 * gauge; every other one holds another site's (erratum `gesla-crms-wrong-site`).
 */
export const isDropped = (file: string): boolean =>
  DROPPED.has(file) ||
  (CRMS.test(file) && !CRMS_EARLY.has(file) && !CRMS_WELLS.has(file.slice(0, 8).toUpperCase()));
