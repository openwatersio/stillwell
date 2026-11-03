/**
 * Angular velocities of the long-period partial tides that BSH uses with the
 * HRoI, in degrees per lunar transit number, from Table 2 of Boesch and
 * Müller-Navarra (2019), https://doi.org/10.5194/os-15-1363-2019.
 *
 * Each is a combination of the rates of s, h, p and N'. `set2` was BSH's list
 * from 1970 to 2019; `set3` (that paper's result) is used from the 2020 tables on,
 * and is what BSH's 2026 files report as "39 39".
 */
export interface PartialTide {
  doodson: string;
  /** Degrees per transit number. */
  omega: number;
  name?: string;
  set2: boolean;
  set3: boolean;
}

// prettier-ignore
export const PARTIAL_TIDES: PartialTide[] = [
  { doodson: "ZZZZAZ", omega: 0.0548098, set2: true, set3: true },
  { doodson: "ZZZAZZ", omega: 0.1153082, set2: true, set3: false },
  { doodson: "ZZZBZZ", omega: 0.2306165, set2: false, set3: true },
  { doodson: "ZZAYZZ", omega: 0.9048862, set2: true, set3: false },
  { doodson: "ZZAZZZ", omega: 1.0201944, name: "Sa", set2: true, set3: true },
  { doodson: "ZZBXZZ", omega: 1.8097724, set2: true, set3: true },
  { doodson: "ZZBZZZ", omega: 2.0403886, name: "Ssa", set2: true, set3: true },
  { doodson: "ZAXZZZ", omega: 11.597842, set2: true, set3: true },
  { doodson: "ZAXAZZ", omega: 11.7131503, name: "MSm", set2: true, set3: true },
  { doodson: "ZAYXZZ", omega: 12.38742, set2: false, set3: true },
  { doodson: "ZAYZZZ", omega: 12.6180365, set2: false, set3: true },
  { doodson: "ZAYAAZ", omega: 12.7881545, set2: false, set3: true },
  { doodson: "ZAZYYZ", omega: 13.4681129, set2: true, set3: false },
  { doodson: "ZAZYZZ", omega: 13.5229227, name: "Mm", set2: true, set3: true },
  { doodson: "ZAZZYZ", omega: 13.5834211, set2: true, set3: false },
  { doodson: "ZAZZZZ", omega: 13.6382309, set2: true, set3: true },
  { doodson: "ZAZZAZ", omega: 13.6930407, set2: true, set3: true },
  { doodson: "ZAZAZZ", omega: 13.7535391, set2: false, set3: true },
  { doodson: "ZABYZZ", omega: 15.5633115, set2: true, set3: false },
  { doodson: "ZABBAZ", omega: 15.964046, set2: false, set3: true },
  { doodson: "ZBWZZZ", omega: 24.2158785, set2: true, set3: true },
  { doodson: "ZBXZYZ", omega: 25.1812631, set2: true, set3: true },
  { doodson: "ZBXZZZ", omega: 25.2360729, name: "MSf", set2: true, set3: true },
  { doodson: "ZBXZAZ", omega: 25.2908827, set2: true, set3: false },
  { doodson: "ZBXAZZ", omega: 25.3513811, set2: true, set3: false },
  { doodson: "ZBYZZZ", omega: 26.2562673, set2: false, set3: true },
  { doodson: "ZBZXZZ", omega: 27.0458453, set2: true, set3: true },
  { doodson: "ZBZYZZ", omega: 27.1611535, set2: true, set3: true },
  { doodson: "ZBZZYZ", omega: 27.221652, set2: true, set3: false },
  { doodson: "ZBZZZZ", omega: 27.2764618, name: "Mf", set2: true, set3: true },
  { doodson: "ZBZZAZ", omega: 27.3312716, set2: true, set3: true },
  { doodson: "ZCVAZZ", omega: 36.9492232, name: "Snu2", set2: true, set3: true },
  { doodson: "ZCWYZZ", omega: 37.7388011, set2: true, set3: false },
  { doodson: "ZCXYYZ", omega: 38.7041858, set2: true, set3: false },
  { doodson: "ZCXYZZ", omega: 38.7589956, name: "SN", set2: true, set3: true },
  { doodson: "ZCXYAZ", omega: 38.8138054, set2: true, set3: false },
  { doodson: "ZCXZZZ", omega: 38.8743038, set2: true, set3: true },
  { doodson: "ZCXAZZ", omega: 38.989612, name: "MStm", set2: true, set3: true },
  { doodson: "ZCZYZZ", omega: 40.7993844, name: "Mfm", set2: true, set3: true },
  { doodson: "ZDUZZZ", omega: 49.4519514, set2: true, set3: true },
  { doodson: "ZDVZZZ", omega: 50.4721458, name: "2SM", set2: true, set3: true },
  { doodson: "ZDXXZZ", omega: 52.2819182, set2: true, set3: false },
  { doodson: "ZDXZZZ", omega: 52.5125347, name: "MSqm", set2: true, set3: true },
  { doodson: "ZDXZAZ", omega: 52.5673444, set2: false, set3: true },
  { doodson: "ZDZZZZ", omega: 54.5529235, set2: true, set3: true },
  { doodson: "ZETAZZ", omega: 62.1852961, set2: true, set3: true },
  { doodson: "ZEVYZZ", omega: 63.9950685, name: "2SMN", set2: true, set3: true },
  { doodson: "ZEVAZZ", omega: 64.2256849, set2: false, set3: true },
  { doodson: "ZEXYZZ", omega: 66.0354573, set2: true, set3: false },
  { doodson: "ZFTZZZ", omega: 75.7082187, set2: true, set3: true },
  { doodson: "ZFVZZZ", omega: 77.7486076, set2: true, set3: true },
  { doodson: "ZHRZZZ", omega: 100.9442917, set2: true, set3: true },
];

export const SET_2 = PARTIAL_TIDES.filter((p) => p.set2);
export const SET_3 = PARTIAL_TIDES.filter((p) => p.set3);

/**
 * Drop partial tides that `transits` transit numbers of record can't separate
 * (Rayleigh criterion), keeping the earlier one of each close pair. Table order
 * runs from slow to fast, so this keeps the lower frequency.
 */
export function resolvable(tides: PartialTide[], transits: number): PartialTide[] {
  const resolution = 360 / transits;
  const kept: PartialTide[] = [];
  for (const tide of tides) {
    if (tide.omega < resolution) continue;
    if (kept.every((k) => Math.abs(k.omega - tide.omega) >= resolution)) kept.push(tide);
  }
  return kept;
}
