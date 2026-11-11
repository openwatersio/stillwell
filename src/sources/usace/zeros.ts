/**
 * Stations whose gauge zero moved partway through their CWMS series, with the
 * first whole day on the zero in use now (the day after the reset, or the
 * month after when only a month is given). CWMS keeps one series across the
 * reset and says so only in the location's description, quoted in `note`, so
 * these are entered by hand. Levels before `since` are never fetched, so a
 * station's files hold one zero. Entries are only ever added or moved later:
 * removing one would let a backfill write the old zero's values back.
 *
 * Left out on purpose: gauges whose zero was "set to NAVD88" with no date and
 * no earlier zero named (new installations), elevations updated without the
 * zero moving (MVK Helena, MVK Bogalusa), MVN Head of Passes (new gauge set to
 * the old one's water surface), and gauges that moved with no datum noted.
 */
export const ZERO_SINCE: Record<string, { since: string; note: string }> = {
  // Its series today ends in 2017, but a person could move it to one that doesn't.
  "MVK.Steele_Bayou": {
    since: "2019-04-01",
    note: "Steele Bayou Drainage Structure Landside. The Vertical Datum for Steele Bayou LS and RS gages were changed sometime during March 2019",
  },
  "MVK.Steele_Bayou-RS": {
    since: "2019-04-01",
    note: "The Vertical Datum for Steele Bayou LS and RS gages were changed sometime during March 2019",
  },
  "MVN.Algiers_Lock": {
    since: "2007-09-20",
    note: "Vertical datum set to NAVD88 (2004.65) on 19Sep2007; prior historic stage data is relative to datum NGVD29",
  },
  "MVN.Algiers_Lock_GIWW": {
    since: "2007-09-20",
    note: "Vertical datum set to NAVD88 (2004.65) on 09/19/2007. ALL prior stage data referenced to gage zero NGVD29",
  },
  "MVN.Alliance": {
    since: "2013-10-10",
    note: "Gage reset to vertical datum NAVD88 (2004.65) on 18JUL2008 ... Gage reset again to vertical datum NAVD88 (2009.55) on 09Oct2013",
  },
  "MVN.Barataria_Bay_WW": {
    since: "2021-11-23",
    note: "New gage installed onto hardened gage tower in Nov. 2021 ... The gage zero is set to NAVD88 (2009.55) on Nov. 22, 2021",
  },
  "MVN.Bayou_Boeuf-Kraemer": {
    since: "2016-03-17",
    note: "Gage reset to NAVD88 (OPUS) GEOID09 on 16Mar2016. All prior stage data is relative to NGVD29",
  },
  "MVN.Boomtown": {
    since: "2021-11-01",
    note: "New gage installed onto HSDRSS gage tower in Oct. 2021 ... All prior data to Oct. 2021 add 0-.35 ft. to gage data to adjust to NAVD88",
  },
  "MVN.Cameron": {
    since: "2013-11-23",
    note: "The vertical datum at this site was set relative to NAVD88, effective 22 November, 2013. Prior historic water levels are relative to zero feet 'Gage'",
  },
  "MVN.CatfishPoint_Nth": {
    since: "1998-02-19",
    note: "Gage reset to unknown vertical datum on 02/18/1998. Prior gage data was referenced to MLG",
  },
  "MVN.CatfishPoint_Sth": {
    since: "1998-02-19",
    note: "Gage reset to unknown vertical datum on 02/18/1998. Prior gage data was referenced to MLG",
  },
  "MVN.Cocodrie": {
    since: "2011-10-12",
    note: "Gage zero set to NAVD88 (2004.65) on 10/11/2011",
  },
  "MVN.Donaldsonville": {
    since: "1988-06-15",
    note: "Adjustment for vertical datum NAVD88 (OPUS 2010): -0.74 ft. ... This adjustment is only for data after 14June1988",
  },
  "MVN.Empire": {
    since: "2015-07-02",
    note: "Gage reset to NAVD88 (2004.65) on 29Nov2005. All prior historic stage data is relative to NGVD29 ... Gage reset to NAVD88 (2009.55) on 01Jul2015",
  },
  "MVN.Empire_FloodGate-Landside": {
    since: "2022-04-19",
    note: 'Transmitting Gage 0 = NAVD88 (2009.55) -0.025 on 18 April 2022. Data prior to 18 April 2022 was referenced to "gage datum"',
  },
  "MVN.Empire_FloodGate-WaterSide": {
    since: "2022-04-19",
    note: 'Transmitting Gage 0 = NAVD88 (2009.55) -0.05 on 18 April 2022. Data prior to 18 April 2022 was referenced to "gage datum"',
  },
  "MVN.Harvey_Canal_Lap": {
    since: "2007-07-10",
    note: "Vertical datum re-set to NAVD88 on July 9, 2007, ALL prior data referenced to NGVD29",
  },
  "MVN.IHNC_Lock": {
    since: "2008-10-16",
    note: "Vertical datum set to NAVD88 (2004.65) on Oct 15, 2008;all prior historic data is relative to NGVD29",
  },
  "MVN.IHNC_NewOrleans": {
    since: "2008-10-31",
    note: "Gage reset and vertical datum set to NAVD88 (2004.65) on Oct 30, 2008, all prior historic data is at gage zero NGVD29",
  },
  "MVN.IHNC_S_Seabrook": {
    since: "2010-06-03",
    note: "Vertical datum NAVD88 (2004.65) established June 2, 2010, prior historic stage data is relative to datum NGVD",
  },
  "MVN.Lake_Charles": {
    since: "2014-01-01",
    note: "The vertical datum at this site was set relative to NAVD88, effective December, 2013. Prior historic water levels are relative to zero feet 'Gage'",
  },
  "MVN.Rigolets": {
    since: "2007-02-13",
    note: "Vertical datum set to NAVD88 on 12 Feb'07, all prior data relative to NGVD29",
  },
  "MVN.S_Pass_PortEads": {
    since: "2011-02-10",
    note: "Gage reset to vertical datum NAVD88 (OPUS 2011) on 09Feb2011. All prior stage data is relative to NGVD29",
  },
  "MVN.St_Francisville": {
    since: "2010-08-25",
    note: "Gage reset and transmitting in NAVD88 (OPUS 2010) on 24Aug2010. All prior stage is relative to GAGE DATUM",
  },
  "MVN.SWPass_BHP": {
    since: "2011-01-01",
    note: "Gage reinstalled December 2010 with vertical reference relative to datum NAVD88. Previous gauge site was at mile 9.2 BHP",
  },
  "MVN.Venice": {
    since: "2015-06-29",
    note: "Gage zero reset to vertical datum NAVD88 (2009.55) on 28Jun2015. All prior historic stage data is relative to NGVD29",
  },
  "MVN.West_Bay": {
    since: "2009-01-31",
    note: "Gage reset to vertical datum NAVD88 (2004.65) on 30Jan2009. All prior stage data is relative to NGVD29",
  },
  "MVN.West_Pointe": {
    since: "2015-07-02",
    note: "Gage zero reset to NAVD88 (2004.65) on 29Nov2005 ... Gage zero reset again to NAVD88 (2009.55) on 01Jul2015",
  },
  "MVS.Cape_Girardeau-Mississippi": {
    since: "1976-11-01",
    note: "GAGE MOVED IN OCT. 1976, PREVIOUSLY LOCATED AT MILE 52.0. DATUM OF GAGE AT PREVIOUS LOCATION WAS 304.77",
  },
  "MVS.Louisiana-Mississippi": {
    since: "1950-01-24",
    note: "PRIOR TO JAN 23, 1950, GAGE WAS LOCATED AT RAILROAD BRIDGE 0.8 MILE DOWNSTREAM, WITH DATUM 0.11 LOWER THAN THAT NOW IN USE",
  },
  "MVS.Paris-Mid_Fork_Salt": {
    since: "1968-07-24",
    note: "PRIOR TO JULY 23, 1968 GAGE WAS LOCATED AT MILE 104.6 & DATUM WAS 621.71 FT NGVD",
  },
  // The current zero was also in use from 1968-10 to 1975-09, before the
  // series this station reads starts (1983).
  "MVS.Santa_Fe-S_Fork_Salt": {
    since: "1986-10-01",
    note: "FEB. 5, 1940 TO SEP. 30, 1968 & OCT. 1975 TO SEP. 1986, AT RIVER MILE 96.2 & WITH DATUM 613.05 FEET NGVD",
  },
  "MVS.Shelbina-N_Fork_Salt": {
    since: "1970-01-01",
    note: "PRIOR TO JAN. 1, 1970, DATUM WAS 664.58 FEET N.G.V.D.",
  },
};
