# BODC: NTSLF delivery format and quality control flags

## Citation

British Oceanographic Data Centre. NTSLF format (sea level delivery formats). https://bodc.ac.uk/resources/delivery_formats/sea_level/ntslf_format (read 2026-11-11).

## License and local copy

Web page; no license stated. No PDF.

## Flags

UK National Tide Gauge Network files carry an "f" column after the time, the observed sea level, and the residual ("The residual is calculated as the observed sea level value minus the predicted tide"), indicating "whether problems have been identified with the time channel, the observed sea level value and the residual". "A blank 'f' column indicates that the value is good."

| Flag | Meaning                                  |
| ---- | ---------------------------------------- |
| M    | Improbable values - BODC quality control |
| N    | Null value                               |
| T    | Interpolated value                       |

Monthly extremes are "calculated over all sampled data during the month" and "exclude any interpolated data", relative to Admiralty Chart Datum.

How M is assigned is in [bodc-uk-tide-gauge-network-2015.md](bodc-uk-tide-gauge-network-2015.md) (about 20 mm from the mid-tide channel or prediction, with analyst judgement).
