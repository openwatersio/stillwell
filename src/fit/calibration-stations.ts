/** A reference station of the fit calibration, pinned to the analysis NOAA's constants are from. */
export interface Pinned {
  id: string;
  /** Why the station is among them, as the report prints it. */
  why: string;
  /** The years NOAA's comment names. */
  years: number[];
  /** NOAA's note on the constants, word for word. */
  comment: string;
  /** How many constituents NOAA sends, where it isn't 37. */
  constituents?: number;
}

/**
 * The reference stations: where NOAA's constants carry the years they were
 * analyzed from, chosen to cover semidiurnal, mixed and diurnal tides, ranges
 * from 0.2 m to 8 m and latitudes from 14°S to 61°N. `comment` is NOAA's own
 * note on the constants, and `years` the analysis years it names. A run stops
 * where NOAA's comment no longer reads the same, since its constants are then
 * from another analysis, and where NOAA sends another number of constituents
 * than `constituents`, 37 where not given.
 */
// prettier-ignore
export const STATIONS: Pinned[] = [
  { id: "1612340", why: "Mixed tide in the open Pacific at 21°N; a gauge of the nodal comparison in docs/fits.md", years: [2014, 2015, 2016, 2017, 2018], comment: "Vector Average of 5 years, 2014-2018.  Sa, Mm, and Mf from 17 years (1998-2018)." },
  { id: "1820000", why: "Semidiurnal tide on an atoll at 9°N, the lowest latitude; a gauge of the nodal comparison", years: [2014, 2015, 2016, 2017, 2018], comment: "Vector Averaged from 5 years 2014-2018.  Sa, Mm, and Mf from average of 15 years (2000-2018)" },
  { id: "1770000", why: "The only gauge south of the equator, at 14°S; NOAA's years aren't consecutive", years: [2016, 2017, 2018, 2019, 2022], comment: "Vector Averaged of 5 years (2016-2019, 2022).  MM, MF from 18 year average (2000-2022)  Sa and SSa from 20 year monthly means" },
  { id: "8410140", why: "Large semidiurnal tide at the mouth of the Bay of Fundy, M2 2.6 m", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years (2015-2019).  Sa and SSa from 20 year analysis." },
  { id: "8443970", why: "Semidiurnal tide, M2 1.4 m, on a record from 1921", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years (2015-2019).  Sa and SSa from 20 year Analysis (2000-2019)" },
  { id: "8518750", why: "Semidiurnal tide in a harbor at a river's mouth", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector Average of 5 years 2018-2022.   SA and SSA from an average of 16 years 2002-2022." },
  { id: "8545240", why: "Tidal river 160 km from the sea, with large shallow-water constituents", years: [2016, 2017, 2018, 2019, 2020], comment: "Vector Average of 5 LSHQA (2016-2020). MM, SSA, Sa, MSF from average of 20 years (2001-2020)" },
  { id: "8574680", why: "Small tide at the head of an estuary, M2 0.15 m, under large weather-driven levels", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years (2017-2021).  Sa and SSa from average of 19 years (2001-2021). Other long period constituents are not stable." },
  { id: "8638610", why: "Semidiurnal tide at the mouth of Chesapeake Bay", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years LSQHA (2015-2019).  Sa and SSa from 19 vector average of 19 years (2000-2019)." },
  { id: "8665530", why: "Semidiurnal tide on the South Atlantic Bight, on a record from 1901", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years LSQHA (2017-2021).  Sa and SSa from average of 18 years (2001-2021)." },
  { id: "8724580", why: "Small mixed tide between the Atlantic and the Gulf of Mexico", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector Average of 5 years (2018-2022).  Sa and Ssa from 20 year monthly means analysis (2002-2022),  Mf from average of 20 year annual analysis." },
  { id: "8729840", why: "Diurnal tide in the Gulf of Mexico; a gauge of the nodal comparison", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector average of 5 years (2018-2022).  Sa and Ssa from 20 year monthly analysis (2002-2022)." },
  { id: "8761724", why: "Diurnal tide on the Mississippi delta; NOAA's years run to the latest", years: [2021, 2022, 2023, 2024, 2025], comment: "Vector Average of 5 years (2021-2025).  Sa and SSa from average of 16 years (2006-2025)." },
  { id: "8771450", why: "Mixed, mainly diurnal tide in a bay on the western Gulf of Mexico", years: [2021, 2022, 2023, 2024, 2025], comment: "Vector average of 5 years (2021-2025).  Ssa and Sa from 19 one-year LSQHA analyses between 2006-2025." },
  { id: "9410170", why: "Mixed tide on the Pacific coast at 33°N, on a record from 1906", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years (2017-2021). Sa from average of 20 years (2002-2021), other long period constituents are unstable." },
  { id: "9435380", why: "Mixed tide on the open Pacific coast at 45°N; an earlier analysis, of six years", years: [2007, 2008, 2009, 2010, 2011, 2012], comment: "Mean of six 1-year LSQHA (2007-2012).  Sa and Ssa from 20 years of MSL (1994-2013). Mf from mean of six LSQHA (2007-2012)." },
  { id: "9449880", why: "Mixed, mainly diurnal tide in the Salish Sea, K1 0.76 m", years: [2011, 2012, 2013, 2014, 2015, 2016], comment: "6 Year Vector Averaged (2011-2016).  Sa, SSa, and MF from 20 years (1997-2016)." },
  { id: "9455920", why: "The largest tide, M2 3.5 m at 61°N, with ice in winter; NOAA publishes 120 constituents", years: [2012, 2013, 2014, 2015, 2016], comment: "5-year (2012-2016) Vector Averaged.  Mm, Msf, Mf from average of 20 years (1996-2016).  Sa and SSa from 20year analysis.", constituents: 120 },
  { id: "9462620", why: "Mixed, mainly diurnal tide in the Aleutians at 54°N", years: [2020, 2021, 2022, 2023, 2024], comment: "Vector Average of 5 years (2020-2024).  Sa and Mf from mean of 18 years (2005-2024)." },
  { id: "9751639", why: "Small mixed, mainly diurnal tide in the Caribbean, K1 0.08 m", years: [2007, 2008, 2009, 2010, 2011, 2012], comment: "Average of 6 LSQHA (2007-2012).  Sa and SSa from 20 year analyses (1993-2012).  Mm and Msf are not used." },
];
