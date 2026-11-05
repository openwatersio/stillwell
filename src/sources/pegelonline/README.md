# PEGELONLINE (`pegelonline`)

Observed water levels at about 690 German federal gauges on the coast, rivers and canals, from the WSV's [PEGELONLINE](https://www.pegelonline.wsv.de/) REST API.

- **License:** [DL-DE/Zero-2.0](https://www.pegelonline.wsv.de/gast/nutzungsbedingungen); commercial use and redistribution allowed.
- **Stations:** every station with a `W` (water level) series and a position, by PEGELONLINE number.
- **Levels:** raw and unchecked, so `preliminary`. Most series are centimeters above gauge zero (PNP), with gauge zero's height in NHN or NN as the datum offset. 67 series are meters above NN and two are meters above PNP; the adapter asks each series for its unit, scales by it, and refuses a series whose unit puts it in another datum than the station's. The gauge zero's `validFrom` is the station's datum reference: a later date opens a new datum epoch, leaving that day out of both, while a new height under the same date is a re-survey that only changes the offset ([docs/stations.md](../../../docs/stations.md)). Tide gauges report every minute, others every 15.
- **History:** the API keeps 31 days. Anything older exists in the lake only from when ingest started, or in GESLA for earlier years.
- **Kind:** stations on the North Sea and Baltic are `coastal`; the rest aren't classified yet.
