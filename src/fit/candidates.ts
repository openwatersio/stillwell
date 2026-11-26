/**
 * The constituents every fit starts from, in priority order: where a record
 * can't separate two of them, the earlier one is kept. Foreman's 45
 * astronomical and 24 shallow-water constituents in his order (Foreman 1977,
 * Manual for Tidal Heights Analysis and Prediction), then the lines NOAA's 37
 * and TICON-4's 50 add, so a fit can be compared with either name for name.
 *
 * Each is defined here by its Doodson numbers and speed, so the list says
 * which line a name means whatever engine fits it. `doodson` holds the
 * multiples of τ, s, h, p, N′ and p′, then the phase constant in quarter
 * cycles. `spellings` are the other names the three lists use for the line.
 *
 * Two pairs of names share a line, and `candidatesFor` gives the order for a set of nodal formulas.
 *
 * Foreman's H1 and H2 are left out under those names: they are M2's neighbors
 * one cycle a year either side, the lines TICON's MA2 and MB2 name.
 */
export interface Candidate {
  name: string;
  doodson: number[];
  /** Degrees per hour. */
  speed: number;
  from: ("foreman" | "noaa" | "ticon")[];
  spellings?: string[];
  /** A shallow-water compound, whose Doodson numbers are its members' combined. */
  compound?: true;
}

// prettier-ignore
export const CANDIDATES: Candidate[] = [
  { name: "Sa", doodson: [0, 0, 1, 0, 0, 0, 0], speed: 0.0410686, from: ["foreman","noaa","ticon"], spellings: ["SA"] },
  { name: "Ssa", doodson: [0, 0, 2, 0, 0, 0, 0], speed: 0.0821373, from: ["foreman","noaa","ticon"], spellings: ["SSA"] },
  { name: "MSm", doodson: [0, 1, -2, 1, 0, 0, 0], speed: 0.4715211, from: ["foreman"] },
  { name: "Mm", doodson: [0, 1, 0, -1, 0, 0, 0], speed: 0.5443747, from: ["foreman","noaa","ticon"], spellings: ["MM"] },
  { name: "MSf", doodson: [0, 2, -2, 0, 0, 0, 0], speed: 1.0158958, from: ["foreman","noaa","ticon"], spellings: ["MSF"] },
  { name: "Mf", doodson: [0, 2, 0, 0, 0, 0, 0], speed: 1.098033, from: ["foreman","noaa","ticon"], spellings: ["MF"] },
  { name: "ALP1", doodson: [1, -4, 2, 1, 0, 0, 1], speed: 12.38276516, from: ["foreman"] },
  { name: "2Q1", doodson: [1, -3, 0, 2, 0, 0, 1], speed: 12.8542862, from: ["foreman","noaa","ticon"] },
  { name: "sigma1", doodson: [1, -3, 2, 0, 0, 0, 1], speed: 12.9271398, from: ["foreman","ticon"], spellings: ["SGM"] },
  { name: "Q1", doodson: [1, -2, 0, 1, 0, 0, 1], speed: 13.3986609, from: ["foreman","noaa","ticon"] },
  { name: "rho1", doodson: [1, -2, 2, -1, 0, 0, 1], speed: 13.4715145, from: ["foreman","noaa","ticon"], spellings: ["RHO","RHO1"] },
  { name: "O1", doodson: [1, -1, 0, 0, 0, 0, 1], speed: 13.9430356, from: ["foreman","noaa","ticon"] },
  { name: "tau1", doodson: [1, -1, 2, 0, 0, 0, -1], speed: 14.0251729, from: ["foreman"] },
  { name: "BET1", doodson: [1, 0, -2, 1, 0, 0, -1], speed: 14.41455671, from: ["foreman"] },
  { name: "NO1", doodson: [1, 0, 0, 1, 0, 0, -1], speed: 14.4966939, from: ["foreman"] },
  { name: "chi1", doodson: [1, 0, 2, -1, 0, 0, -1], speed: 14.5695476, from: ["foreman"] },
  { name: "pi1", doodson: [1, 1, -3, 0, 0, 1, 1], speed: 14.9178647, from: ["foreman"] },
  { name: "P1", doodson: [1, 1, -2, 0, 0, 0, 1], speed: 14.9589314, from: ["foreman","noaa","ticon"] },
  { name: "S1", doodson: [1, 1, -1, 0, 0, 0, 0], speed: 15, from: ["foreman","noaa","ticon"] },
  { name: "K1", doodson: [1, 1, 0, 0, 0, 0, -1], speed: 15.0410686, from: ["foreman","noaa","ticon"] },
  { name: "psi1", doodson: [1, 1, 1, 0, 0, -1, -1], speed: 15.0821353, from: ["foreman"] },
  { name: "phi1", doodson: [1, 1, 2, 0, 0, 0, -1], speed: 15.123206, from: ["foreman"] },
  { name: "theta1", doodson: [1, 2, -2, 1, 0, 0, -1], speed: 15.5125897, from: ["foreman"] },
  { name: "J1", doodson: [1, 2, 0, -1, 0, 0, -1], speed: 15.5854433, from: ["foreman","noaa","ticon"] },
  { name: "SO1", doodson: [1, 3, -2, 0, 0, 0, -1], speed: 16.0569644, from: ["foreman"] },
  { name: "OO1", doodson: [1, 3, 0, 0, 0, 0, -1], speed: 16.1391017, from: ["foreman","noaa","ticon"] },
  { name: "ups1", doodson: [1, 4, 0, -1, 0, 0, -1], speed: 16.6834764, from: ["foreman"] },
  { name: "eps2", doodson: [2, -3, 2, 1, 0, 0, 0], speed: 27.4238338, from: ["foreman","ticon"], spellings: ["EP2"] },
  { name: "2N2", doodson: [2, -2, 0, 2, 0, 0, 0], speed: 27.8953548, from: ["foreman","noaa","ticon"] },
  { name: "mu2", doodson: [2, -2, 2, 0, 0, 0, 0], speed: 27.9682085, from: ["foreman","noaa","ticon"], spellings: ["MU2"] },
  { name: "N2", doodson: [2, -1, 0, 1, 0, 0, 0], speed: 28.4397295, from: ["foreman","noaa","ticon"] },
  { name: "nu2", doodson: [2, -1, 2, -1, 0, 0, 0], speed: 28.5125832, from: ["foreman","noaa","ticon"], spellings: ["NU2"] },
  { name: "gamma2", doodson: [2, 0, -2, 2, 0, 0, -2], speed: 28.9112506, from: ["foreman"] },
  { name: "M2", doodson: [2, 0, 0, 0, 0, 0, 0], speed: 28.9841042, from: ["foreman","noaa","ticon"] },
  { name: "MKS2", doodson: [2, 0, 2, 0, 0, 0, 0], speed: 29.0662415, from: ["foreman","ticon"] },
  { name: "lambda2", doodson: [2, 1, -2, 1, 0, 0, -2], speed: 29.4556253, from: ["foreman","noaa","ticon"], spellings: ["LAM2","LAMBDA2"] },
  { name: "L2", doodson: [2, 1, 0, -1, 0, 0, -2], speed: 29.5284789, from: ["foreman","noaa","ticon"] },
  { name: "T2", doodson: [2, 2, -3, 0, 0, 1, 0], speed: 29.9589333, from: ["foreman","noaa","ticon"] },
  { name: "S2", doodson: [2, 2, -2, 0, 0, 0, 0], speed: 30, from: ["foreman","noaa","ticon"] },
  { name: "R2", doodson: [2, 2, -1, 0, 0, -1, -2], speed: 30.0410667, from: ["foreman","noaa","ticon"] },
  { name: "K2", doodson: [2, 2, 0, 0, 0, 0, 0], speed: 30.0821373, from: ["foreman","noaa","ticon"] },
  { name: "MSN2", doodson: [2, 3, -2, -1, 0, 0, 0], speed: 30.5443747, from: ["foreman"] },
  { name: "eta2", doodson: [2, 3, 0, -1, 0, 0, 0], speed: 30.626512, from: ["foreman"] },
  { name: "MO3", doodson: [3, -1, 0, 0, 0, 0, 1], speed: 42.9271398, from: ["foreman"] },
  { name: "M3", doodson: [3, 0, 0, 0, 0, 0, 0], speed: 43.4761564, from: ["foreman","noaa","ticon"] },
  { name: "SO3", doodson: [3, 1, -2, 0, 0, 0, 1], speed: 43.9430356, from: ["foreman"] },
  { name: "MK3", doodson: [3, 1, 0, 0, 0, 0, -1], speed: 44.0251729, from: ["foreman","noaa"] },
  { name: "SK3", doodson: [3, 3, -2, 0, 0, 0, -1], speed: 45.0410686, from: ["foreman","ticon"], spellings: ["R3"] },
  { name: "MN4", doodson: [4, -1, 0, 1, 0, 0, 0], speed: 57.4238338, from: ["foreman","noaa","ticon"] },
  { name: "M4", doodson: [4, 0, 0, 0, 0, 0, 0], speed: 57.9682085, from: ["foreman","noaa","ticon"] },
  { name: "SN4", doodson: [4, 1, -2, 1, 0, 0, 0], speed: 58.4397295, from: ["foreman"] },
  { name: "MS4", doodson: [4, 2, -2, 0, 0, 0, 0], speed: 58.9841042, from: ["foreman","noaa","ticon"] },
  { name: "MK4", doodson: [4, 2, 0, 0, 0, 0, 0], speed: 59.0662415, from: ["foreman"] },
  { name: "S4", doodson: [4, 4, -4, 0, 0, 0, 0], speed: 60, from: ["foreman","noaa","ticon"] },
  { name: "SK4", doodson: [4, 4, -2, 0, 0, 0, 0], speed: 60.0821373, from: ["foreman"] },
  { name: "2MK5", doodson: [5, 1, 0, 0, 0, 0, -1], speed: 73.009277, from: ["foreman","ticon"] },
  { name: "2SK5", doodson: [5, 5, -4, 0, 0, 0, -1], speed: 75.0410686, from: ["foreman"], compound: true },
  { name: "2MN6", doodson: [6, -1, 0, 1, 0, 0, 0], speed: 86.407938, from: ["foreman"] },
  { name: "M6", doodson: [6, 0, 0, 0, 0, 0, 0], speed: 86.9523127, from: ["foreman","noaa","ticon"] },
  { name: "2MS6", doodson: [6, 2, -2, 0, 0, 0, 0], speed: 87.9682085, from: ["foreman","ticon"] },
  { name: "2MK6", doodson: [6, 2, 0, 0, 0, 0, 0], speed: 88.0503458, from: ["foreman"] },
  { name: "2SM6", doodson: [6, 4, -4, 0, 0, 0, 0], speed: 88.9841042, from: ["foreman"] },
  { name: "MSK6", doodson: [6, 4, -2, 0, 0, 0, 0], speed: 89.0662415, from: ["foreman"] },
  { name: "3MK7", doodson: [7, 1, 0, 0, 0, 0, -1], speed: 101.9933814, from: ["foreman"] },
  { name: "M8", doodson: [8, 0, 0, 0, 0, 0, 0], speed: 115.936417, from: ["foreman","noaa","ticon"] },
  { name: "S6", doodson: [6, 6, -6, 0, 0, 0, 0], speed: 90, from: ["noaa"], compound: true },
  { name: "M1", doodson: [1, 0, 0, 1, 0, 0, -1], speed: 14.4966939, from: ["noaa","ticon"] },
  { name: "2SM2", doodson: [2, 4, -4, 0, 0, 0, 0], speed: 31.0158958, from: ["noaa","ticon"] },
  { name: "2MK3", doodson: [3, -1, 0, 0, 0, 0, 1], speed: 42.9271398, from: ["noaa"] },
  { name: "MSqm", doodson: [0, 4, -2, 0, 0, 0, 0], speed: 2.1139287, from: ["ticon"], spellings: ["MSQM"] },
  { name: "Mfm", doodson: [0, 3, 0, -1, 0, 0, 0], speed: 1.6424078, from: ["ticon"], spellings: ["MTM"] },
  { name: "N4", doodson: [4, -2, 0, 2, 0, 0, 0], speed: 56.8794591, from: ["ticon"] },
  { name: "S3", doodson: [3, 3, -3, 0, 0, 0, 0], speed: 45, from: ["ticon"] },
  { name: "MA2", doodson: [2, 0, -1, 0, 0, 0, 0], speed: 28.943036, from: ["ticon"] },
  { name: "MB2", doodson: [2, 0, 1, 0, 0, 0, 0], speed: 29.025173, from: ["ticon"] },
  { name: "T3", doodson: [3, 3, -4, 0, 0, 0, 0], speed: 44.9589333, from: ["ticon"] },
  { name: "3L2", doodson: [2, 1, 0, 0, 0, 0, 0], speed: 29.5331208, from: ["ticon"] },
  { name: "3N2", doodson: [2, -1, 0, 0, 0, 0, 1], speed: 28.4350877, from: ["ticon"] },
  { name: "2MO5", doodson: [5, -1, 0, 0, 0, 0, 1], speed: 71.911244, from: ["ticon"] },
];

/** A set of nodal correction formulas, as `@slackwater/engine` names them. */
export type NodeCorrections = "iho" | "schureman" | "foreman";

/**
 * Where two names in the list share a line, the name a set of nodal formulas holds it under, by the
 * name that comes first in the list. docs/fits.md, under Constituents, says why each is here. A set
 * with no entry keeps the list's own order.
 */
export const PREFERRED: Partial<Record<NodeCorrections, Record<string, string>>> = {
  schureman: { NO1: "M1", MO3: "2MK3" },
  iho: { NO1: "M1" },
};

/**
 * The candidates in priority order for fits under `corrections`: the list, with each preferred
 * name in the place of the name it shares a line with, and that name where the preferred one was.
 */
export function candidatesFor(corrections: NodeCorrections): Candidate[] {
  const list = [...CANDIDATES];
  for (const [name, preferred] of Object.entries(PREFERRED[corrections] ?? {})) {
    const [i, j] = [
      list.findIndex((c) => c.name === name),
      list.findIndex((c) => c.name === preferred),
    ];
    if (i < 0 || j < 0) throw new Error(`the candidate list has no ${i < 0 ? name : preferred}`);
    const [a, b] = [list[i]!, list[j]!];
    if (a.speed !== b.speed || a.doodson.join() !== b.doodson.join())
      throw new Error(`${name} and ${preferred} aren't one line`);
    if (i < j) [list[i], list[j]] = [b, a];
  }
  return list;
}
