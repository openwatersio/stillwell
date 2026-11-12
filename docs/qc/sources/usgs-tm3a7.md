# USGS Techniques and Methods 3-A7, Stage measurement at gaging stations

## Citation

Sauer, V.B., and Turnipseed, D.P., 2010, Stage measurement at gaging stations: U.S. Geological Survey Techniques and Methods, book 3, chap. A7, 45 p. Supersedes Buchanan and Somers (1968), TWRI 3-A7.

- Landing page: https://pubs.usgs.gov/tm/tm3-a7/
- PDF: https://pubs.usgs.gov/tm/tm3-a7/tm3a7.pdf

## License and local copy

U.S. Geological Survey publication, in the public domain. The report notes that permission is needed from individual copyright owners to reproduce any copyrighted material inside it (some photographs and figures). Because of that third-party material the PDF is linked, not copied.

Page numbers below are the printed page numbers.

## What it covers

The report is about instruments and field practice for collecting stage (gage height) at USGS gaging stations on streams, reservoirs, lakes and estuaries. It does not prescribe automated time-series screening thresholds. Its QC content is about where errors come from, how to verify a recorder against a reference gage, and how to keep the gage datum fixed.

## Accuracy standard (pp. 3 to 4)

- Stage must be stored as instantaneous values, not averages. Averaging is done later in processing.
- Overall accuracy for USGS gaging stations is "either 0.01 foot or 0.2 percent of the effective stage, whichever is greater." Examples given: 0.06 ft at an effective stage of 30 ft, 0.02 ft at 10 ft, 0.01 ft at all effective stages below 7.5 ft. Effective stage is the height of the water surface above the orifice, intake or other point where the sensor meets the water.
- The standard applies to the whole station (sensor, recorder, retrieval), not one component.
- "The same accuracy requirements apply at reservoirs, lakes, and estuaries as those for stream sites."
- Nonsubmersible pressure transducer component standard: 0.01 ft or 0.10 percent of effective stage, whichever is greater (p. 5, citing OSW Technical Memorandum 96.05).
- Where wave action, high velocity or channel instability prevent accurate stage, collect it "with the greatest accuracy feasible."

## Gage datum (pp. 3 to 4)

- Datum may be a recognized datum (NAVD 88, NGVD 29) or an arbitrary datum chosen for convenience. NGVD 29 was the predominant datum for lakes and reservoirs; NAVD 88 is the datum the USGS recommends for the streamgaging network, and gages on other datums "should be resurveyed or converted to NAVD 88" where NAVD 88 exists.
- An arbitrary datum is normally set below the lowest expected gage height (below the zero-flow stage) so readings are never negative.
- "Maintain a permanent gage datum, if at all possible, so that only one datum for the gage-height record is used for the life of the gaging station." Use at least three permanent reference marks independent of the gage structure.
- A datum change is made only for cause (excessive scour, a manmade channel change, or relocating the gage), in whole feet or meters so the old and new datums relate simply, and the relation is defined by leveling. A permanent history of all datum changes is kept.
- An arbitrary datum's relation to NAVD 88 is established by levels (or a GPS survey) so the datum can be recovered if the gage is destroyed.

## Datum errors and leveling (p. 4, pp. 43 to 44)

- Gage movement (uplift, settlement) causes datum errors that only leveling detects. Reference gage datum is kept to 0.01 ft, usually by leveling to reference marks every 2 or 3 years; unstable sites need more frequent levels.
- "Generally, gages do not need to be adjusted unless datum discrepancies exceed 0.02 ft."
- General considerations (pp. 43 to 44): at new sites and sites with an unstable datum, run levels at least once a year; once stable, every 2 or 3 years or longer. A program of careful inspection and maintenance "will result in a complete gage-height record about 98 to 99 percent of the time."
- Level-survey procedure is Kenney (2010), USGS TM 3-A19.

## Sources of error that QC has to catch (pp. 4 to 5)

- Gage reading errors: read to the nearest 0.01 ft; average several readings when surge is present.
- Float systems: a leaking float, slipped float-tape clamp, or an animal resting on the float usually makes the float ride low and gage readings too low. Partly clogged stilling-well intakes make the inside stage lag the stream.
- Float-tape weight shift can add small positive errors as stage rises. Gas bubbler systems have errors from line friction, gas-column weight and bubble rate. Submersible transducers vary with water temperature and density.
- Pressure transducers can have calibration offsets in either direction. Radar and other noncontact sensors have wind, waves, floating debris and air-gap uncertainty.
- Hydraulically induced errors: high velocity near an intake or orifice can cause drawdown or buildup of "0.5 ft or more." The check is simultaneous inside and outside gage readings at high stage, or an inside-outside gage relation used as a correction.
- Recorder and retrieval errors: logger conversion equations, mechanical play in float wheels, and download failures can produce wrong or lost values.

## Verification (p. 5)

"Stage readings require frequent and consistent verification." Listed procedures: frequent reading of independent auxiliary gages, comparing inside and outside gages, high-water marks, redundant max/min recording (float-tape Dahman indicators), crest-stage gages, and regular level surveys. Hydrographers keep records of recorded-versus-reference comparisons and any corrections applied. A "final recheck" of all instruments is made before leaving a station after any other work (pp. 43).

## Not covered

No numeric range, rate-of-change or flat-line thresholds, no ice handling for stage, no upstream or downstream comparison, and no flag scheme. For USGS review practice see [usgs-stage-approval-guidance.md](usgs-stage-approval-guidance.md), [usgs-wrd-99-34-realtime-qa.md](usgs-wrd-99-34-realtime-qa.md) and [usgs-osw-records-policy.md](usgs-osw-records-policy.md).
