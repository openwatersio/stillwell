# SHOM/REFMAR: Contrôle qualité des mesures mises à disposition par le SHOM (2011)

## Citation

SHOM, 2011. Contrôle qualité des mesures mises à disposition par le SHOM. ControleQualite_REFMAR-V1.01, 1 July 2010, last updated 30 August 2011. 10 pp. In French.

- PDF: https://refmar.shom.fr/sites/default/files/2024-01/ControleQualite_REFMAR-V1.01.pdf

## License and local copy

No license statement in the document. Link only.

## What it describes

The QC SHOM applies to its RONIM network (homogeneous radar sensors, one procedure for all sites) before data reach REFMAR. Quotes below are translated from French.

## Data levels (section III.C-D)

- Raw: 10-minute values, each the integration over 2 minutes of 1-second radar samples; polled weekly and published unvalidated.
- Validated: memory cards retrieved every 4 months; the SHOM analyst checks the 10-minute data, then publishes hourly validated values to the historical series.

## On-site checks (section III.A-B)

Direct readings with a light probe (sonde lumineuse) at least twice a year, inside and outside the well (which also detects silting). Van de Casteele test over a full spring-tide cycle at installation and occasionally after, giving calibration coefficients. Benchmark levelling at least every 5 years.

## Methods (section IV.C)

1. Observations versus predictions: both curves plus the residual (surge) are always plotted; "analysis of this residual allows detection of the main anomalies (phase shifts, spikes, ...)"; the residual is interpreted together with hourly atmospheric pressure.
2. Standard deviations of the 120 averaged samples are checked when needed; a high SD with a doubtful mean points to an acquisition problem.
3. Hourly values by cubic spline interpolation of validated 10-minute data.
4. Mean levels with the Demerliac filter, interpreted against atmospheric pressure.
5. Comparison with neighbouring ports: surge spatial coherence along the coast, and differences of mean levels "to check the coherence of the vertical references and detect any reference jump".
6. Concordance plots between two ports.
7. Annual harmonic analysis to see interannual variability and detect systematic errors "(dating, scale factor, ...)".

## Error types and actions (section V)

- Vertical reference jumps (boat impact, damage, harbour works, earthquake, recalibration error): large ones visible directly; small or gradual ones found by differencing daily or monthly means with a stable nearby gauge.
- Isolated spikes and out-of-range values: "corrected by interpolation. The erroneous value is replaced by the interpolated value."
- Longer offset from an instrument problem: "Correction impossible, the data are then invalidated."
- Silting of the stilling tube or well (curve deformed, tube does not empty): data invalidated with a comment; some ports moved to open-air radars.
- Time offsets: clocks are synchronised from Brest, accuracy normally better than a minute. A known offset over a well-identified period is corrected afterward; "abnormal time drifts will not be corrected, the data will then be invalidated."
- Every correction is commented in the SHOM database and summarised on REFMAR.

## Flags

No numeric flag scheme is given in this document. Not verified whether REFMAR data files carry flags.
