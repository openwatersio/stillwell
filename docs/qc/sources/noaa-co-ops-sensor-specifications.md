# NOAA CO-OPS Environmental Measurement Systems: Sensor Specifications and Measurement Algorithms

## Citation

NOAA National Ocean Service, CO-OPS. Environmental Measurement Systems: Sensor Specifications and Measurement Algorithms. Updated December 2025 (PDF title "CO-OPS_Measurement_Spec_Updated_December 2025"). 12 pp.

- PDF: https://tidesandcurrents.noaa.gov/publications/CO-OPS_Measurement_Spec.pdf (the URL serves the current revision; earlier revisions dated 2006, 2013, 2015 and 2020 exist)

## License and local copy

U.S. Government work, public domain. PDF included: [pdf/noaa-co-ops-sensor-specifications-2025.pdf](pdf/noaa-co-ops-sensor-specifications-2025.pdf) (0.2 MB), the December 2025 revision as downloaded 2026-11-11.

## What it prescribes for QC

This is the on-sensor first stage of CO-OPS QC (the "DQAP" referred to in QARTOD). It defines how each 6-minute water level is formed and which QC statistics travel with it:

- All water level sensors: minimum resolution 0.001 m; six-minute transmission.
- Primary acoustic (Aquatrak in protective well): "Each individual measurement is the average of 181 one-second water level samples, centered on each tenth of an hour, with a three standard deviation outlier rejection test applied. The standard deviation and number of rejected outliers for this average are also reported." (3-minute average.)
- Primary microwave radar (YSI WaterLog H-3611, Nile 502, NOAA Nile): average of 360 one-second samples centered on each tenth of an hour, same 3-SD outlier rejection, SD and outlier count reported (6-minute average).
- Primary dual and single orifice bubblers: 36 five-second samples, same rejection test.
- Backup bubbler (Sutron with Accubar): 72 five-second samples, same rejection test.
- Tsunami Ready stations also send six 1-minute averages per 6-minute transmission.
- Estimated accuracy relative to datum: ±0.02 m for individual measurements, ±0.005 m for monthly means.

These reported SD and outlier counts feed the sigma and outlier flags described in NOS CO-OPS 030 and 061.
