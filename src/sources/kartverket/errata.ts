import type { ErrataFile } from "../../errata.ts";

export default {
  errata: [],
  retired: [],
  questions: [
    {
      id: "kartverket-constants-clock",
      stations: "every station",
      question:
        "The tide API's `constituents` answer gives phases against UTC+1 (`utcoffset=\"+01:00\"`). Fitted from the API's own observations for the same period, the phases at 24 gauges ask for about 68 seconds more than one hour. Does the harmonic analysis take its astronomical arguments in UTC or in terrestrial time, and which program and version was it run with?",
      why: "The store's comparison of its fits with the published constants moves each phase by one hour and by terrestrial time minus UTC, about 67 s. A stated convention would replace that estimate.",
      meanwhile:
        "Phases are moved by one hour and by terrestrial time minus UTC over the period, and the calibration reports the seconds each gauge's fitted phases ask for, with their intervals.",
      asked: null,
      answer: null,
    },
    {
      id: "kartverket-constants-filter",
      stations: "every station",
      question:
        "Above four cycles a day the published constants are smaller than a fit of the API's 10-minute observations gives, by what a zero-phase fourth-order Butterworth low-pass filter with a cutoff near 2.98 hours would take off (about 7% at M6 and 30% at M8). Which series did the harmonic analysis read, and through which filter?",
      why: "The comparison scales the fit's amplitudes by that filter's gain, estimated from the published constants themselves, so above four cycles a day it shows only that the constants are consistent with one filter. The stated filter would make it an independent check.",
      meanwhile:
        "The calibration estimates the filter's order and cutoff from the constants at 4.5 cycles a day and faster and says so in its report.",
      asked: null,
      answer: null,
    },
    {
      id: "kartverket-constants-hammerfest",
      stations: ["kartverket/HFT"],
      question:
        "The protocol says some stations' constants come from a nearby station. Are any of Hammerfest's, and were its observations for 2006 to 2020 filled or edited before the analysis? A fit of the API's observations for that period differs from ten of its published semidiurnal constants (2N2, MU2, NU2, GAM2, H1, MKS2, L2, T2, S2 and OQ2) by up to 0.5 mm and 10°, which is more than at any other gauge.",
      why: "Hammerfest is the one gauge where the store's fit of Kartverket's period falls outside its intervals for more than one constant, and neither leaving out any year or pair of years nor the gauge's latitude accounts for it.",
      meanwhile:
        "The calibration reports Hammerfest's ten constants as outside and unexplained. The store's values for the gauge are as the API serves them.",
      asked: null,
      answer: null,
    },
    {
      id: "kartverket-constants-viker-k1",
      stations: ["kartverket/VIK"],
      question:
        "The tide API's `constituents` answer for Viker has no K1, though it has P1 and S1 and every other gauge's answer has K1. Was K1 left out of Viker's analysis, or out of the answer?",
      why: "K1 is one of the constituents the store's comparison with the published constants gives apart, and at Viker there is none to compare.",
      meanwhile:
        "The calibration compares the constituents Viker's answer has and says that K1 isn't among them.",
      asked: null,
      answer: null,
    },
  ],
} satisfies ErrataFile;
