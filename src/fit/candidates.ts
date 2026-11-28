/**
 * The constituents every fit starts from. Foreman's 45 astronomical and 24
 * shallow-water constituents in order of frequency within the long-period
 * band and each species (Foreman 1977, Manual for Tidal Heights Analysis and
 * Prediction, Appendix 1), then the lines NOAA's 37 and TICON-4's 50 add, so
 * a fit can be compared with either name for name.
 *
 * `comparison` is the constituent Foreman's table tests a candidate against
 * by the Rayleigh criterion: a record that can't separate the two by a cycle
 * leaves the candidate out. A candidate without one is tested against every
 * candidate kept before it in the list. docs/fits.md says which candidates
 * those are and what a record of a year keeps.
 *
 * Each is defined here by its Doodson numbers and speed, so the list says
 * which line a name means whatever engine fits it. `doodson` holds the
 * multiples of τ, s, h, p, N′ and p′, then the phase constant in quarter
 * cycles. `spellings` are the other names the lists use for the line. A
 * compound's Doodson numbers are its members' combined.
 *
 * Foreman's H1 and H2 are left out under those names: they are M2's neighbors
 * one cycle a year either side, the lines TICON's MA2 and MB2 name. MA2 and
 * MB2 carry H1's and H2's comparison, M2, and gamma2 is compared with MA2
 * where Foreman compares it with H1.
 */
export interface Candidate {
  name: string;
  doodson: number[];
  /** Degrees per hour. */
  speed: number;
  /** The lists that have the line; `shallow` marks one of `SHALLOW`. */
  from: ("foreman" | "noaa" | "ticon" | "shallow")[];
  /** The candidate the Rayleigh criterion tests this one against. Without one, every candidate kept before it. */
  comparison?: string;
  spellings?: string[];
  /** A shallow-water compound, whose Doodson numbers are its members' combined. */
  compound?: true;
}

// prettier-ignore
export const CANDIDATES: Candidate[] = [
  { name: "Sa", doodson: [0, 0, 1, 0, 0, 0, 0], speed: 0.0410686, from: ["foreman","noaa","ticon"], spellings: ["SA"] },
  { name: "Ssa", doodson: [0, 0, 2, 0, 0, 0, 0], speed: 0.0821373, from: ["foreman","noaa","ticon"], spellings: ["SSA"] },
  { name: "MSm", doodson: [0, 1, -2, 1, 0, 0, 0], speed: 0.4715211, from: ["foreman"], comparison: "Mm" },
  { name: "Mm", doodson: [0, 1, 0, -1, 0, 0, 0], speed: 0.5443747, from: ["foreman","noaa","ticon"], comparison: "MSf", spellings: ["MM"] },
  { name: "MSf", doodson: [0, 2, -2, 0, 0, 0, 0], speed: 1.0158958, from: ["foreman","noaa","ticon"], spellings: ["MSF"] },
  { name: "Mf", doodson: [0, 2, 0, 0, 0, 0, 0], speed: 1.098033, from: ["foreman","noaa","ticon"], comparison: "MSf", spellings: ["MF"] },
  { name: "ALP1", doodson: [1, -4, 2, 1, 0, 0, 1], speed: 12.38276516, from: ["foreman"], comparison: "2Q1" },
  { name: "2Q1", doodson: [1, -3, 0, 2, 0, 0, 1], speed: 12.8542862, from: ["foreman","noaa","ticon"], comparison: "Q1" },
  { name: "sigma1", doodson: [1, -3, 2, 0, 0, 0, 1], speed: 12.9271398, from: ["foreman","ticon"], comparison: "2Q1", spellings: ["SGM","SIGMA1"] },
  { name: "Q1", doodson: [1, -2, 0, 1, 0, 0, 1], speed: 13.3986609, from: ["foreman","noaa","ticon"], comparison: "O1" },
  { name: "rho1", doodson: [1, -2, 2, -1, 0, 0, 1], speed: 13.4715145, from: ["foreman","noaa","ticon"], comparison: "Q1", spellings: ["RHO","RHO1"] },
  { name: "O1", doodson: [1, -1, 0, 0, 0, 0, 1], speed: 13.9430356, from: ["foreman","noaa","ticon"], comparison: "K1" },
  { name: "tau1", doodson: [1, -1, 2, 0, 0, 0, -1], speed: 14.0251729, from: ["foreman"], comparison: "O1" },
  { name: "BET1", doodson: [1, 0, -2, 1, 0, 0, -1], speed: 14.41455671, from: ["foreman"], comparison: "NO1" },
  { name: "NO1", doodson: [1, 0, 0, 1, 0, 0, -1], speed: 14.4966939, from: ["foreman"], comparison: "K1" },
  { name: "chi1", doodson: [1, 0, 2, -1, 0, 0, -1], speed: 14.5695476, from: ["foreman"], comparison: "NO1", spellings: ["CHI1"] },
  { name: "pi1", doodson: [1, 1, -3, 0, 0, 1, 1], speed: 14.9178647, from: ["foreman"], comparison: "P1" },
  { name: "P1", doodson: [1, 1, -2, 0, 0, 0, 1], speed: 14.9589314, from: ["foreman","noaa","ticon"], comparison: "K1" },
  { name: "S1", doodson: [1, 1, -1, 0, 0, 0, 0], speed: 15, from: ["foreman","noaa","ticon"], comparison: "K1" },
  { name: "K1", doodson: [1, 1, 0, 0, 0, 0, -1], speed: 15.0410686, from: ["foreman","noaa","ticon"] },
  { name: "psi1", doodson: [1, 1, 1, 0, 0, -1, -1], speed: 15.0821353, from: ["foreman"], comparison: "K1" },
  { name: "phi1", doodson: [1, 1, 2, 0, 0, 0, -1], speed: 15.123206, from: ["foreman"], comparison: "K1" },
  { name: "theta1", doodson: [1, 2, -2, 1, 0, 0, -1], speed: 15.5125897, from: ["foreman"], comparison: "J1", spellings: ["THETA1"] },
  { name: "J1", doodson: [1, 2, 0, -1, 0, 0, -1], speed: 15.5854433, from: ["foreman","noaa","ticon"], comparison: "K1" },
  { name: "SO1", doodson: [1, 3, -2, 0, 0, 0, -1], speed: 16.0569644, from: ["foreman"], comparison: "OO1" },
  { name: "OO1", doodson: [1, 3, 0, 0, 0, 0, -1], speed: 16.1391017, from: ["foreman","noaa","ticon"], comparison: "J1" },
  { name: "ups1", doodson: [1, 4, 0, -1, 0, 0, -1], speed: 16.6834764, from: ["foreman"], comparison: "OO1" },
  { name: "eps2", doodson: [2, -3, 2, 1, 0, 0, 0], speed: 27.4238338, from: ["foreman","ticon"], comparison: "2N2", spellings: ["EP2"] },
  { name: "2N2", doodson: [2, -2, 0, 2, 0, 0, 0], speed: 27.8953548, from: ["foreman","noaa","ticon"], comparison: "mu2" },
  { name: "mu2", doodson: [2, -2, 2, 0, 0, 0, 0], speed: 27.9682085, from: ["foreman","noaa","ticon"], comparison: "N2", spellings: ["MU2"] },
  { name: "N2", doodson: [2, -1, 0, 1, 0, 0, 0], speed: 28.4397295, from: ["foreman","noaa","ticon"], comparison: "M2" },
  { name: "nu2", doodson: [2, -1, 2, -1, 0, 0, 0], speed: 28.5125832, from: ["foreman","noaa","ticon"], comparison: "N2", spellings: ["NU2"] },
  { name: "gamma2", doodson: [2, 0, -2, 2, 0, 0, -2], speed: 28.9112506, from: ["foreman"], comparison: "MA2" },
  { name: "M2", doodson: [2, 0, 0, 0, 0, 0, 0], speed: 28.9841042, from: ["foreman","noaa","ticon"] },
  { name: "MKS2", doodson: [2, 0, 2, 0, 0, 0, 0], speed: 29.0662415, from: ["foreman","ticon"], comparison: "M2" },
  { name: "lambda2", doodson: [2, 1, -2, 1, 0, 0, -2], speed: 29.4556253, from: ["foreman","noaa","ticon"], comparison: "L2", spellings: ["LAM2","LAMBDA2"] },
  { name: "L2", doodson: [2, 1, 0, -1, 0, 0, -2], speed: 29.5284789, from: ["foreman","noaa","ticon"], comparison: "S2" },
  { name: "T2", doodson: [2, 2, -3, 0, 0, 1, 0], speed: 29.9589333, from: ["foreman","noaa","ticon"], comparison: "S2" },
  { name: "S2", doodson: [2, 2, -2, 0, 0, 0, 0], speed: 30, from: ["foreman","noaa","ticon"], comparison: "M2" },
  { name: "R2", doodson: [2, 2, -1, 0, 0, -1, -2], speed: 30.0410667, from: ["foreman","noaa","ticon"], comparison: "S2" },
  { name: "K2", doodson: [2, 2, 0, 0, 0, 0, 0], speed: 30.0821373, from: ["foreman","noaa","ticon"], comparison: "S2" },
  { name: "MSN2", doodson: [2, 3, -2, -1, 0, 0, 0], speed: 30.5443747, from: ["foreman"], comparison: "eta2" },
  { name: "eta2", doodson: [2, 3, 0, -1, 0, 0, 0], speed: 30.626512, from: ["foreman"], comparison: "K2" },
  { name: "MO3", doodson: [3, -1, 0, 0, 0, 0, 1], speed: 42.9271398, from: ["foreman"], comparison: "M3" },
  { name: "M3", doodson: [3, 0, 0, 0, 0, 0, 0], speed: 43.4761564, from: ["foreman","noaa","ticon"], comparison: "M2" },
  { name: "SO3", doodson: [3, 1, -2, 0, 0, 0, 1], speed: 43.9430356, from: ["foreman"], comparison: "MK3" },
  { name: "MK3", doodson: [3, 1, 0, 0, 0, 0, -1], speed: 44.0251729, from: ["foreman","noaa"], comparison: "M3" },
  { name: "SK3", doodson: [3, 3, -2, 0, 0, 0, -1], speed: 45.0410686, from: ["foreman","ticon"], comparison: "MK3", spellings: ["R3"] },
  { name: "MN4", doodson: [4, -1, 0, 1, 0, 0, 0], speed: 57.4238338, from: ["foreman","noaa","ticon"], comparison: "M4" },
  { name: "M4", doodson: [4, 0, 0, 0, 0, 0, 0], speed: 57.9682085, from: ["foreman","noaa","ticon"], comparison: "M3" },
  { name: "SN4", doodson: [4, 1, -2, 1, 0, 0, 0], speed: 58.4397295, from: ["foreman"], comparison: "M4" },
  { name: "MS4", doodson: [4, 2, -2, 0, 0, 0, 0], speed: 58.9841042, from: ["foreman","noaa","ticon"], comparison: "M4" },
  { name: "MK4", doodson: [4, 2, 0, 0, 0, 0, 0], speed: 59.0662415, from: ["foreman"], comparison: "MS4" },
  { name: "S4", doodson: [4, 4, -4, 0, 0, 0, 0], speed: 60, from: ["foreman","noaa","ticon"], comparison: "MS4" },
  { name: "SK4", doodson: [4, 4, -2, 0, 0, 0, 0], speed: 60.0821373, from: ["foreman"], comparison: "S4" },
  { name: "2MK5", doodson: [5, 1, 0, 0, 0, 0, -1], speed: 73.009277, from: ["foreman","ticon"], comparison: "M4" },
  { name: "2SK5", doodson: [5, 5, -4, 0, 0, 0, -1], speed: 75.0410686, from: ["foreman"], comparison: "2MK5", compound: true },
  { name: "2MN6", doodson: [6, -1, 0, 1, 0, 0, 0], speed: 86.407938, from: ["foreman"], comparison: "M6" },
  { name: "M6", doodson: [6, 0, 0, 0, 0, 0, 0], speed: 86.9523127, from: ["foreman","noaa","ticon"], comparison: "2MK5" },
  { name: "2MS6", doodson: [6, 2, -2, 0, 0, 0, 0], speed: 87.9682085, from: ["foreman","ticon"], comparison: "M6" },
  { name: "2MK6", doodson: [6, 2, 0, 0, 0, 0, 0], speed: 88.0503458, from: ["foreman"], comparison: "2MS6" },
  { name: "2SM6", doodson: [6, 4, -4, 0, 0, 0, 0], speed: 88.9841042, from: ["foreman"], comparison: "2MS6" },
  { name: "MSK6", doodson: [6, 4, -2, 0, 0, 0, 0], speed: 89.0662415, from: ["foreman"], comparison: "2SM6" },
  { name: "3MK7", doodson: [7, 1, 0, 0, 0, 0, -1], speed: 101.9933814, from: ["foreman"], comparison: "M6" },
  { name: "M8", doodson: [8, 0, 0, 0, 0, 0, 0], speed: 115.936417, from: ["foreman","noaa","ticon"], comparison: "3MK7" },
  { name: "S6", doodson: [6, 6, -6, 0, 0, 0, 0], speed: 90, from: ["noaa"], compound: true },
  { name: "M1", doodson: [1, 0, 0, 1, 0, 0, -1], speed: 14.4966939, from: ["noaa","ticon"] },
  { name: "2SM2", doodson: [2, 4, -4, 0, 0, 0, 0], speed: 31.0158958, from: ["noaa","ticon"] },
  { name: "2MK3", doodson: [3, -1, 0, 0, 0, 0, 1], speed: 42.9271398, from: ["noaa"] },
  { name: "MSqm", doodson: [0, 4, -2, 0, 0, 0, 0], speed: 2.1139287, from: ["ticon"], spellings: ["MSQM"] },
  { name: "Mfm", doodson: [0, 3, 0, -1, 0, 0, 0], speed: 1.6424078, from: ["ticon"], spellings: ["MTM"] },
  { name: "N4", doodson: [4, -2, 0, 2, 0, 0, 0], speed: 56.8794591, from: ["ticon"] },
  { name: "S3", doodson: [3, 3, -3, 0, 0, 0, 0], speed: 45, from: ["ticon"] },
  { name: "MA2", doodson: [2, 0, -1, 0, 0, 0, 0], speed: 28.943036, from: ["ticon"], comparison: "M2" },
  { name: "MB2", doodson: [2, 0, 1, 0, 0, 0, 0], speed: 29.025173, from: ["ticon"], comparison: "M2" },
  { name: "T3", doodson: [3, 3, -4, 0, 0, 0, 0], speed: 44.9589333, from: ["ticon"] },
  { name: "3L2", doodson: [2, 1, 0, 0, 0, 0, 0], speed: 29.5331208, from: ["ticon"] },
  { name: "3N2", doodson: [2, -1, 0, 0, 0, 0, 1], speed: 28.4350877, from: ["ticon"] },
  { name: "2MO5", doodson: [5, -1, 0, 0, 0, 0, 1], speed: 71.911244, from: ["ticon"] },
];

/**
 * The shallow-water compounds NOAA publishes for Anchorage (`coops/9455920`)
 * beyond its 37, on lines `CANDIDATES` doesn't have, largest at Anchorage
 * first. A large tide in shallow water puts energy on them: at Anchorage they
 * carry 123 mm RMS. No fit starts from them. The calibration fits each of its
 * gauges with them after `CANDIDATES` and reports what they change
 * (docs/results/fit-calibration.md), which is the evidence for whether fits
 * should.
 *
 * Not every name NOAA uses at Anchorage is here under that name:
 *
 * - MP1, MNS2, TK1, RP1, KP1 and KJ2 have the speed of a candidate already
 *   listed (tau1, eps2, pi1, psi1, phi1 and eta2) and aren't listed again.
 *   RP1 and KJ2 are half a cycle from psi1 and eta2 in phase.
 * - NOAA's SIGMA1 is compared with `sigma1`, though fitted NOAA's way sigma1
 *   is 7.8 mm from NOAA's 47 mm constant there, which the calibration
 *   reports as open.
 * - NOAA's 4MSL12 has the speed of `6MSN12` and is half a cycle from it, with
 *   other node factors. The line is here as 6MSN12, which is what the
 *   engine's catalog defines, and not as a spelling of NOAA's name.
 * - `OQ2` is the O1 + Q1 compound at 27.3416965° an hour, as NOAA's OO2 is.
 *   Foreman's OQ2, which `CANDIDATES` leaves out, is another line.
 */
// prettier-ignore
export const SHALLOW: Candidate[] = [
  { name: "3MS8", doodson: [8, 2, -2, 0, 0, 0, 0], speed: 116.9523127, from: ["shallow"] },
  { name: "NO3", doodson: [3, -2, 0, 1, 0, 0, 1], speed: 42.3827651, from: ["shallow"] },
  { name: "MLN2S2", doodson: [2, -4, 4, 0, 0, 0, -2], speed: 26.9523127, from: ["shallow"] },
  { name: "3MS4", doodson: [4, -2, 2, 0, 0, 0, 0], speed: 56.9523127, from: ["shallow"] },
  { name: "4MS10", doodson: [10, 2, -2, 0, 0, 0, 0], speed: 145.936417, from: ["shallow"], compound: true },
  { name: "MSL6", doodson: [6, 3, -2, -1, 0, 0, -2], speed: 88.512583, from: ["shallow"] },
  { name: "3MN8", doodson: [8, -1, 0, 1, 0, 0, 0], speed: 115.3920423, from: ["shallow"] },
  { name: "2MLNS6", doodson: [6, -2, 2, 0, 0, 0, -2], speed: 85.936417, from: ["shallow"] },
  { name: "MSKO7", doodson: [7, 3, -2, 0, 0, 0, 1], speed: 103.0092771, from: ["shallow"] },
  { name: "3MLS6", doodson: [6, -1, 2, -1, 0, 0, -2], speed: 86.4807917, from: ["shallow"] },
  { name: "MSK5", doodson: [5, 3, -2, 0, 0, 0, -1], speed: 74.0251729, from: ["shallow"] },
  { name: "2MLS4", doodson: [4, -1, 2, -1, 0, 0, -2], speed: 57.4966874, from: ["shallow"] },
  { name: "ML4", doodson: [4, 1, 0, -1, 0, 0, -2], speed: 58.5125832, from: ["shallow"] },
  { name: "2MP5", doodson: [5, 1, -2, 0, 0, 0, 1], speed: 72.92714, from: ["shallow"] },
  { name: "MSN6", doodson: [6, 1, -2, 1, 0, 0, 0], speed: 87.4238338, from: ["shallow"] },
  { name: "2ML2S2", doodson: [2, -3, 4, -1, 0, 0, -2], speed: 27.4966874, from: ["shallow"] },
  { name: "2ML6", doodson: [6, 1, 0, -1, 0, 0, -2], speed: 87.496687, from: ["shallow"] },
  { name: "2MSO7", doodson: [7, 1, -2, 0, 0, 0, 1], speed: 101.9112441, from: ["shallow"] },
  { name: "OQ2", doodson: [2, -3, 0, 1, 0, 0, -2], speed: 27.3416965, from: ["shallow"], spellings: ["OO2"] },
  { name: "SKM2", doodson: [2, 4, -2, 0, 0, 0, 0], speed: 31.098033, from: ["shallow"] },
  { name: "2NMLS6", doodson: [6, -3, 2, 1, 0, 0, -2], speed: 85.3920423, from: ["shallow"] },
  { name: "2MSN8", doodson: [8, 1, -2, 1, 0, 0, 0], speed: 116.407938, from: ["shallow"] },
  { name: "2(MS)8", doodson: [8, 4, -4, 0, 0, 0, 0], speed: 117.9682085, from: ["shallow"], spellings: ["2MS8"] },
  { name: "3MP5", doodson: [5, -1, 2, 0, 0, 0, -1], speed: 71.9933814, from: ["shallow"] },
  { name: "SL4", doodson: [4, 3, -2, -1, 0, 0, -2], speed: 59.528479, from: ["shallow"] },
  { name: "MNK5", doodson: [5, 0, 0, 1, 0, 0, -1], speed: 72.4649024, from: ["shallow"] },
  { name: "2NM6", doodson: [6, -2, 0, 2, 0, 0, 0], speed: 85.8635633, from: ["shallow"] },
  { name: "2MSL8", doodson: [8, 3, -2, -1, 0, 0, -2], speed: 117.4966874, from: ["shallow"] },
  { name: "3MSN10", doodson: [10, 1, -2, 1, 0, 0, 0], speed: 145.3920423, from: ["shallow"], spellings: ["3MNS10"], compound: true },
  { name: "MNO5", doodson: [5, -2, 0, 1, 0, 0, 1], speed: 71.3668694, from: ["shallow"] },
  { name: "3M2S10", doodson: [10, 4, -4, 0, 0, 0, 0], speed: 146.9523127, from: ["shallow"], compound: true },
  { name: "2PO1", doodson: [1, 3, -4, 0, 0, 0, 1], speed: 15.9748271, from: ["shallow"] },
  { name: "5MS12", doodson: [12, 2, -2, 0, 0, 0, 0], speed: 174.9205212, from: ["shallow"], compound: true },
  { name: "M10", doodson: [10, 0, 0, 0, 0, 0, 0], speed: 144.9205212, from: ["shallow"], compound: true },
  { name: "4MN10", doodson: [10, -1, 0, 1, 0, 0, 0], speed: 144.3761465, from: ["shallow"], compound: true },
  { name: "2MNO7", doodson: [7, -2, 0, 1, 0, 0, 1], speed: 100.3509736, from: ["shallow"] },
  { name: "4MLS8", doodson: [8, -1, 2, -1, 0, 0, -2], speed: 115.4648959, from: ["shallow"] },
  { name: "3MK8", doodson: [8, 2, 0, 0, 0, 0, 0], speed: 117.03445, from: ["shallow"] },
  { name: "2MSK8", doodson: [8, 4, -2, 0, 0, 0, 0], speed: 118.0503458, from: ["shallow"] },
  { name: "3MSK9", doodson: [9, 3, -2, 0, 0, 0, -1], speed: 131.9933814, from: ["shallow"] },
  { name: "4MSN12", doodson: [12, 1, -2, 1, 0, 0, 0], speed: 174.3761465, from: ["shallow"], spellings: ["4MNS12"], compound: true },
  { name: "4M2S12", doodson: [12, 4, -4, 0, 0, 0, 0], speed: 175.936417, from: ["shallow"], compound: true },
  { name: "3MSL10", doodson: [10, 3, -2, -1, 0, 0, -2], speed: 146.4807915, from: ["shallow"], compound: true },
  { name: "2(MN)8", doodson: [8, -2, 0, 2, 0, 0, 0], speed: 114.8476676, from: ["shallow"], spellings: ["2MN8"] },
  { name: "3KM5", doodson: [5, 3, 0, 0, 0, 0, -1], speed: 74.1073102, from: ["shallow"] },
  { name: "2NS2", doodson: [2, -4, 2, 2, 0, 0, 0], speed: 26.8794591, from: ["shallow"] },
  { name: "4MK9", doodson: [9, 1, 0, 0, 0, 0, -1], speed: 130.9774856, from: ["shallow"] },
  { name: "4MSK11", doodson: [11, 3, -2, 0, 0, 0, -1], speed: 160.9774856, from: ["shallow"], compound: true },
  { name: "3ML8", doodson: [8, 1, 0, -1, 0, 0, -2], speed: 116.4807917, from: ["shallow"] },
  { name: "6MSN12", doodson: [12, 3, -2, -1, 0, 0, 0], speed: 175.4648959, from: ["shallow"], compound: true },
  { name: "OP2", doodson: [2, 0, -2, 0, 0, 0, -2], speed: 28.901967, from: ["shallow"] },
  { name: "M2(KS)2", doodson: [2, 0, 4, 0, 0, 0, 0], speed: 29.148378, from: ["shallow"], spellings: ["M2KS2"] },
  { name: "3MNK9", doodson: [9, 0, 0, 1, 0, 0, -1], speed: 130.4331109, from: ["shallow"] },
  { name: "2MS2K2", doodson: [2, -2, -2, 0, 0, 0, 0], speed: 27.8039339, from: ["shallow"] },
  { name: "2NMK7", doodson: [7, -1, 0, 2, 0, 0, -1], speed: 100.904632, from: ["shallow"] },
  { name: "MKL2S2", doodson: [2, -1, 4, -1, 0, 0, -2], speed: 28.5947204, from: ["shallow"] },
  { name: "2M2NK9", doodson: [9, -1, 0, 2, 0, 0, -1], speed: 129.8887362, from: ["shallow"] },
  { name: "2KM(SN)2", doodson: [2, 3, 2, -1, 0, 0, 0], speed: 30.7086493, from: ["shallow"], spellings: ["2KMSN2"] },
  { name: "2SN(MK)2", doodson: [2, 1, -4, 1, 0, 0, 0], speed: 29.373488, from: ["shallow"], spellings: ["2SNMK2"] },
];
