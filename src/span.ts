// Imports nothing, so adapters can use it without QC's harmonic dependencies.

/**
 * Levels no gauge can read in any datum the store holds, in meters: below the
 * Dead Sea's shore or above Everest. QARTOD's gross range test fails a value
 * outside the sensor's span whatever the window holds, which catches a year
 * that is all placeholder, such as USACE's 30,479.695 m (99,999 ft), where
 * the window's own median is the placeholder. A scan of every year file in
 * November 2026 found no real level above 1,817 m, at USGS's Lyman Lake.
 * The store leaves out a level outside it: every fetch of levels drops one,
 * as do backfill, compaction and requalify from the stored rows they write.
 */
export const SPAN_M = [-500, 9000] as const;

/** Whether a level is finite and within `SPAN_M`; NaN fails both comparisons. */
export const possible = (level: number) => level >= SPAN_M[0] && level <= SPAN_M[1];
