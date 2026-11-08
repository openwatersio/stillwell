import { km } from "./ticon.ts";

interface Position {
  lat: number;
  lon: number;
}

/**
 * Stations a source places away from their gauge, each moved to where another
 * source puts it. `served` is the source's own position, so a source that
 * moves the station itself stops the correction: the station keeps the
 * source's position, and the refresh reports the entry and fails the run so a
 * person checks it. A station the source stops listing keeps
 * its corrected position in the lake, as it keeps the rest of the station. UHSLC's are erratum `uhslc-positions`.
 * GESLA's are erratum `gesla-uhslc-positions`: its copies of UHSLC series keep
 * metadata UHSLC had when GESLA copied it, and UHSLC has corrected most since.
 */
export const POSITIONS: Record<string, { served: Position; at: Position }> = {
  // PSMSL's Stanley (1082) has the same years as 290A, 1964–1974. UHSLC and
  // GESLA put it in the open South Atlantic, 112 km south of Stanley.
  "uhslc/290a": {
    served: { lat: -52.7, lon: -57.8667 },
    at: { lat: -51.690339, lon: -57.864931 },
  },
  "gesla/port_stanley-290a-gbr-uhslc_rq": {
    served: { lat: -52.7, lon: -57.867 },
    at: { lat: -51.690339, lon: -57.864931 },
  },
  // PSMSL's Stanley II (1796), from 1992 as 290 and 290B are, is in Stanley
  // Harbour. UHSLC's position, which IOC copies, is 10 km southwest.
  "uhslc/290": {
    served: { lat: -51.75, lon: -57.9333 },
    at: { lat: -51.692358, lon: -57.820514 },
  },
  "gesla/port_stanley-290-gbr-uhslc_fd": {
    served: { lat: -51.75, lon: -57.933 },
    at: { lat: -51.692358, lon: -57.820514 },
  },
  "gesla/port_stanley-290b-gbr-uhslc_rq": {
    served: { lat: -51.75, lon: -57.933 },
    at: { lat: -51.692358, lon: -57.820514 },
  },
  // IOC's sea level monitoring lists Meulaboh (meul) at 4.1275, 96.1319, on
  // the harbour. UHSLC's position is 23 km northeast, GESLA's 111 km north.
  "uhslc/914": {
    served: { lat: 4.316667, lon: 96.21667 },
    at: { lat: 4.1274865, lon: 96.131854 },
  },
  "gesla/meulaboh-914-idn-uhslc_fd": {
    served: { lat: 5.128, lon: 96.132 },
    at: { lat: 4.1274865, lon: 96.131854 },
  },
  // IOC lists Acapulco API (acap2) at 16.8379, -99.903, 1 km from UHSLC's
  // other versions and GESLA's UNAM records. 316C's is 5 km east.
  "uhslc/316": {
    served: { lat: 16.8417, lon: -99.8517 },
    at: { lat: 16.8379333, lon: -99.903 },
  },
  "gesla/acapulco_gro-316c-mex-uhslc_rq": {
    served: { lat: 16.842, lon: -99.852 },
    at: { lat: 16.8379333, lon: -99.903 },
  },
  // CO-OPS places its Kaumalapau Harbor gauge (1614465) at 20.79, -156.995,
  // as GESLA's FD copy has it. UHSLC's position, which PSMSL and IOC copy, is
  // 10 km east, inland.
  "uhslc/548": {
    served: { lat: 20.78, lon: -156.9 },
    at: { lat: 20.79, lon: -156.995 },
  },
  "gesla/kaumalapau_hi-548a-usa-uhslc_rq": {
    served: { lat: 20.78, lon: -156.9 },
    at: { lat: 20.79, lon: -156.995 },
  },
  // 054A, 1947–1991, is NOAA's Moen Island gauge (coops/1840000), as GESLA's
  // copy places it. UHSLC gives it its current gauge's position, 5 km east.
  "uhslc/054a": {
    served: { lat: 7.45368, lon: 151.8982 },
    at: { lat: 7.44667, lon: 151.847 },
  },
  // PSMSL lists Mossel Bay (910) at -34.1786, 22.1353, as GESLA's RQ copy has
  // it. GESLA's FD copy is 22 km northeast.
  "gesla/mossel_bay-185-zaf-uhslc_fd": {
    served: { lat: -34.067, lon: 22.333 },
    at: { lat: -34.178611, lon: 22.135278 },
  },

  // GESLA's copies below keep a position UHSLC has since corrected. UHSLC's
  // current position agrees with the source named.
  // IOC's Thule - Pituffik (thul).
  "gesla/thule_pituffik-808-dnk-uhslc_fd": {
    served: { lat: 76, lon: -68 },
    at: { lat: 76.5434, lon: -68.8626 },
  },
  // IOC's Castletownbere (cast). GESLA's is 51 km east, near Castletownshend.
  "gesla/castletownbere-835-irl-uhslc_fd": {
    served: { lat: 51.533, lon: -9.183 },
    at: { lat: 51.6496, lon: -9.9034 },
  },
  "gesla/castletownsend-835a-irl-uhslc_rq": {
    served: { lat: 51.533, lon: -9.183 },
    at: { lat: 51.6496, lon: -9.9034 },
  },
  // PSMSL's Pulau Langkawi (1676). GESLA's is 49 km north, in Thailand.
  "gesla/langkawi-142a-mys-uhslc_rq": {
    served: { lat: 6.87, lon: 99.77 },
    at: { lat: 6.43049, lon: 99.76286 },
  },
  // IOC's Sao Tome (saot), on Ana Chaves Bay. GESLA's is 44 km southwest.
  "gesla/sao_tome-225a-stp-uhslc_rq": {
    served: { lat: 0.017, lon: 6.513 },
    at: { lat: 0.348333, lon: 6.736667 },
  },
  // GLOSS's Porto de Macaé (352), by Imbetiba harbour. GESLA's is at sea.
  "gesla/macae-719a-bra-uhslc_rq": {
    served: { lat: -22.233, lon: -41.467 },
    at: { lat: -22.385, lon: -41.77 },
  },
  // IOC's Sadeng (sade). GESLA's is 35 km south, at sea.
  "gesla/sadeng-417-idn-uhslc_fd": {
    served: { lat: -8.5, lon: 110.783 },
    at: { lat: -8.190194, lon: 110.79798 },
  },
  // IOC's Tasiilaq Harbour (tasw). GESLA's is 29 km east.
  "gesla/ammassalik-297a-dnk-uhslc_rq": {
    served: { lat: 65.6, lon: -37 },
    at: { lat: 65.615, lon: -37.625 },
  },
  // IOC's Port Sonara (sona), 4.0058, 9.1259. GESLA's is 23 km north.
  "gesla/port_sonara-816-cmr-uhslc_fd": {
    served: { lat: 4.217, lon: 9.133 },
    at: { lat: 4.0067, lon: 9.1267 },
  },
  // PSMSL's Alotau (1607), on the Milne Bay waterfront. GESLA's is 17 km north.
  "gesla/alotau-069a-png-uhslc_rq": {
    served: { lat: -10.168, lon: 150.453 },
    at: { lat: -10.3167, lon: 150.4533 },
  },
  // UHSLC's research-quality series of the same gauge, on the shore. GESLA's
  // and IOC's position, 15 km northeast, is 8 km inland, in the city.
  "gesla/nouakchott-806-mrt-uhslc_fd": {
    served: { lat: 18.1, lon: -15.95 },
    at: { lat: 17.99, lon: -16.0367 },
  },
  // UHSLC's research-quality series, at Inhambane's waterfront; GESLA's and
  // IOC's position is 14 km southeast, across the bay.
  "gesla/inhambane-900-moz-uhslc_fd": {
    served: { lat: -23.917, lon: 35.5 },
    at: { lat: -23.8683, lon: 35.3767 },
  },
  // IOC's Davao (davo), where the series has been since it began in 1998.
  // GESLA's is PSMSL's older Davao gauge (537), 8 km away, which GESLA's 372A
  // keeps.
  "gesla/davao-372-phl-uhslc_fd": {
    served: { lat: 7.083, lon: 125.633 },
    at: { lat: 7.1537, lon: 125.6629 },
  },
  // PSMSL's Bundaberg, Burnett Heads (1154).
  "gesla/bundaberg-332-aus-uhslc_fd": {
    served: { lat: -24.833, lon: 152.35 },
    at: { lat: -24.7667, lon: 152.38 },
  },
  // JMA's Ofunato (jma/OF) and IOC's (ofun).
  "gesla/ofunato-351-jpn-uhslc_fd": {
    served: { lat: 39.067, lon: 141.717 },
    at: { lat: 39.0167, lon: 141.75 },
  },
  // IOC's Saint Helena, Ruperts Bay (sthl2).
  "gesla/st_helena-292-shn-uhslc_fd": {
    served: { lat: -15.967, lon: -5.7 },
    at: { lat: -15.9167, lon: -5.7167 },
  },
};

/** Farthest a source's position can move before its correction is out of date. */
const SERVED_KM = 0.5;

/**
 * A source's stations with those `POSITIONS` names moved to where they are,
 * and each entry the source has moved its station away from.
 */
export function correctPositions<T extends Position & { id: string }>(
  stations: T[],
): { stations: T[]; stale: string[] } {
  const stale: string[] = [];
  const corrected = stations.map((s) => {
    const fix = POSITIONS[s.id];
    if (!fix) return s;
    if (!(km(s, fix.served) <= SERVED_KM)) {
      stale.push(`${s.id} is now at ${s.lat}, ${s.lon}, not ${fix.served.lat}, ${fix.served.lon}`);
      return s;
    }
    return { ...s, lat: fix.at.lat, lon: fix.at.lon };
  });
  return { stations: corrected, stale };
}
