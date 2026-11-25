/**
 * Cross-check findings (src/findings.ts) judged, that the next run would
 * still find, each with the reason: what the values show and how that was
 * confirmed, naming the erratum where one answers it. Which findings need an
 * entry is in docs/contributing/checks.md. An entry changes nothing in the
 * store and is never reported to the agency.
 */
import type { Reviewed } from "./findings.ts";

export const reviewed: Reviewed[] = [];
