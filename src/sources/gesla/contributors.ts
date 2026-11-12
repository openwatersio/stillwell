import { NOTICES } from "../uhslc/notices.ts";

/**
 * GESLA's contributors, by the abbreviation in its metadata's `CONTRIBUTOR
 * (ABBREVIATED)` column and each file name's last part, with the terms the
 * store tags their records with. GESLA's license page lists, for each
 * contributor, whether its data may be used for research only or for
 * research and consultancy; `commercial_use` is the stricter of that and the
 * originator's own terms where this repo has checked them. UHSLC's records
 * take each record's terms from the UHSLC scan instead (`index.ts`).
 */
export interface Contributor {
  /** The contributor's name, credited after GESLA's. */
  name: string;
  commercial_use: boolean;
  /** Why, in short. */
  terms: string;
}

const RESEARCH_AND_CONSULTANCY = "GESLA's license table: research and consultancy.";
const unlisted = (who: string) =>
  `Not on GESLA's license table, which lists GESLA-3's contributors; ${who}.`;

export const CONTRIBUTORS: Record<string, Contributor> = {
  NOAA: {
    name: "National Oceanic and Atmospheric Administration",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  MEDS: {
    name: "Marine Environmental Data Section, Fisheries and Oceans Canada",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. The gauges are the Canadian Hydrographic Service's, whose terms need a separate license for any commercial use (tide-database#320).",
  },
  CMEMS: {
    name: "Copernicus Marine Service",
    commercial_use: false,
    terms:
      "GESLA's license table: research only; consultancy needs permission from the agencies that gave the data to CMEMS.",
  },
  UHSLC_RQ: {
    name: "University of Hawaii Sea Level Center",
    commercial_use: true,
    terms:
      "UHSLC's terms: free use and redistribution. A record whose UHSLC documentation file carries a contributor's own terms follows them.",
  },
  UHSLC_FD: {
    name: "University of Hawaii Sea Level Center",
    commercial_use: true,
    terms:
      "UHSLC's terms: free use and redistribution. A record whose UHSLC documentation file carries a contributor's own terms follows them.",
  },
  USGS: {
    name: "United States Geological Survey",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  CRMS: {
    name: "Coastwide Reference Monitoring System, Louisiana",
    commercial_use: true,
    terms: unlisted(
      "CPRA's CIMS disclaimer puts CPRA's data in the public domain and lets it be distributed or copied, asking for a credit",
    ),
  },
  RWS: { name: "Rijkswaterstaat", commercial_use: true, terms: RESEARCH_AND_CONSULTANCY },
  RWS_HIST: { name: "Rijkswaterstaat", commercial_use: true, terms: RESEARCH_AND_CONSULTANCY },
  BOM: {
    name: NOTICES.bom!.credit!,
    commercial_use: true,
    terms: `${RESEARCH_AND_CONSULTANCY} BOM allowed use of its data under the conditions of use for its tide information, which ask for its copyright acknowledgement and disclaimers (openwatersio/stillwell#80); the credit links them.`,
  },
  WSV: {
    name: "Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV)",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  CDWR: {
    name: "California Department of Water Resources",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  REFMAR: {
    name: "REFMAR (Shom)",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  JODC_JMA: {
    name: "Japan Oceanographic Data Center; Japan Meteorological Agency",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. JODC's terms forbid passing its data to third parties without permission, which is being asked for (openwatersio/stillwell#47).",
  },
  JODC_PAHB: {
    name: "Japan Oceanographic Data Center; Ports and Harbours Bureau",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. JODC's terms forbid passing its data to third parties without permission, which is being asked for (openwatersio/stillwell#47).",
  },
  JODC_JCG: {
    name: "Japan Oceanographic Data Center; Japan Coast Guard",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. JODC's terms forbid passing its data to third parties without permission, which is being asked for (openwatersio/stillwell#47).",
  },
  JODC_GIAJ: {
    name: "Japan Oceanographic Data Center; Geospatial Information Authority of Japan",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. JODC's terms forbid passing its data to third parties without permission, which is being asked for (openwatersio/stillwell#47).",
  },
  SMHI: {
    name: "Swedish Meteorological and Hydrological Institute",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  UNAM: {
    name: "Servicio Mareográfico Nacional, Instituto de Geofísica, UNAM",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. UNAM's own site allows only non-profit, unaltered reproduction; permission is being asked for (openwatersio/stillwell#48).",
  },
  UNAM_HIST: {
    name: "Servicio Mareográfico Nacional, Instituto de Geofísica, UNAM",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. UNAM's own site allows only non-profit, unaltered reproduction; permission is being asked for (openwatersio/stillwell#48).",
  },
  BODC: {
    name: "British Oceanographic Data Centre, as part of the function of the National Tidal and Sea Level Facility; Environment Agency",
    commercial_use: true,
    terms: `${RESEARCH_AND_CONSULTANCY} BODC's processed UK National Tide Gauge Network data is under the Open Government Licence v3.0, as its ERDDAP datasets state and BODC confirmed in writing (ticket BODCREQ-11479, openwatersio/stillwell#80), which allows republishing it under CC BY 4.0, crediting BODC and the Environment Agency.`,
  },
  SFWMD: {
    name: "South Florida Water Management District",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  ISPRA: {
    name: "Istituto Superiore per la Protezione e la Ricerca Ambientale (ISPRA)",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  NCDEM: {
    name: "North Carolina Department of Emergency Management",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  MI_C: { name: "Marine Institute", commercial_use: true, terms: RESEARCH_AND_CONSULTANCY },
  MI_R: { name: "Marine Institute", commercial_use: true, terms: RESEARCH_AND_CONSULTANCY },
  NHS: {
    name: "Norwegian Hydrographic Service (Kartverket)",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  DA_SAT: {
    name: "Stefan A. Talke (data archaeology)",
    commercial_use: true,
    terms: "GESLA's license table: research and consultancy, for data archaeology (DA).",
  },
  DA_IDH: {
    name: "Ivan D. Haigh (data archaeology)",
    commercial_use: true,
    terms: "GESLA's license table: research and consultancy, for data archaeology (DA).",
  },
  DA_MM: {
    name: "Marta Marcos (data archaeology)",
    commercial_use: true,
    terms: "GESLA's license table: research and consultancy, for data archaeology (DA).",
  },
  TTW: {
    name: "Toitū Te Whenua Land Information New Zealand",
    commercial_use: true,
    terms: unlisted(
      "Toitū Te Whenua publishes its sea level data under CC BY 3.0 NZ, crediting Land Information New Zealand",
    ),
  },
  HCT: {
    name: "Harris County, Texas",
    commercial_use: false,
    terms: unlisted("Harris County's own terms are still to check"),
  },
  CM: {
    name: "California county gauges (OneRain)",
    commercial_use: false,
    terms: unlisted("the counties' own terms are still to check"),
  },
  CCO: {
    name: "Coastal Channel Observatory",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  FMI: {
    name: "Finnish Meteorological Institute",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  IEO: {
    name: "Instituto Español de Oceanografía",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  NWFWMD: {
    name: "Northwest Florida Water Management District",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. NWFWMD's own terms are still to check (openwatersio/stillwell#52).",
  },
  NOC: {
    name: "National Oceanography Centre",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  ESEAS: {
    name: "European Sea-Level Service",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  BFG: {
    name: "Bundesanstalt für Gewässerkunde",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  DMI: {
    name: "Danish Meteorological Institute",
    commercial_use: false,
    terms:
      "GESLA's license table: research and consultancy. DMI's notice on UHSLC's records of the same gauges bars commercial use; DMI has been asked whether its CC BY 4.0 terms cover them (openwatersio/stillwell#80).",
  },
  GLOSS: {
    name: "Global Sea Level Observing System",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  ICG: {
    name: "Icelandic Coast Guard",
    commercial_use: true,
    terms: RESEARCH_AND_CONSULTANCY,
  },
  CV: {
    name: "City of Venice, Tide Forecast and Reporting Center",
    commercial_use: false,
    terms:
      "GESLA's license table: research only; consultancy needs the City of Venice's permission.",
  },
  UZ: {
    name: "University of Zagreb",
    commercial_use: false,
    terms:
      "GESLA's license table: research only; consultancy needs the University of Zagreb's permission.",
  },
};
