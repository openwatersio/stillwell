# Evaluation scripts

The scripts behind the measurements in [evaluation.md](../evaluation.md). They read the public store and the QC code in [src/](../../../src/); they write nothing to the store. The store changes, so a rerun can differ from the numbers in the evaluation, which were measured in November 2026 against `main` at 4caa051e.

Run them from the repository root after `npm install`. The TypeScript scripts import `qc` from `src/qc.ts` and `qcFor` from `src/store/recent.ts`; `spike-variants.ts` patches a copy of `src/qc.ts` and fails if the code it patches has changed. In every script a value counts as raised by QC when its flag is suspect or bad (3 or 4) and its `source_flag` is good, interpolated or preliminary (under 3), a missing `source_flag` counting as good ([store.ts](store.ts), `raised`); a source-suspect value QC makes bad doesn't count. The scripts are type-checked with the rest of the repository (`npm run typecheck`). The Python scripts need `duckdb` (`pip install duckdb`), and `float32.py` needs `numpy`.

The synthetic counts in `non-finite.ts` depend on the Node version, since the order a sort with NaN leaves is up to the engine: under Node 24.22.1, the 24.x release `.mise.toml` resolved to when measured, it prints 12 missed spikes; under Node 26.13.0 it prints 14.

| Script                                         | What it does                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [export.py](export.py)                         | Exports a station's levels for a year and the years either side to JSON, one datum epoch (the current one by default), with its kind, `tidal` and `tide_m`; fails on a listed year it can't read. |
| [store.ts](store.ts)                           | Reads an export as `requalify` reads the store, with `qcFor`'s options; the TypeScript scripts below use it.                                                                                      |
| [query.py](query.py)                           | Runs SQL against the public store.                                                                                                                                                                |
| [gap-edge.py](gap-edge.py)                     | Counts values QC raised at and near gaps in one year file.                                                                                                                                        |
| [rerun.ts](rerun.ts)                           | Reruns `qc` on an exported station-year as `requalify` does, compares with the stored flags, and attributes each flag to a rule.                                                                  |
| [synthetic.ts](synthetic.ts)                   | Synthetic cases for the suspected gaps in [current-pipeline.md](../current-pipeline.md).                                                                                                          |
| [spike-variants.ts](spike-variants.ts)         | Compares the spike rule's neighbor reference with five alternatives, counting flags and values judged.                                                                                            |
| [non-finite.ts](non-finite.ts)                 | What non-finite levels do to `qc`.                                                                                                                                                                |
| [residual-prototype.ts](residual-prototype.ts) | Prototype residual jump-and-return, residual range and attenuation tests.                                                                                                                         |
| [timing.ts](timing.ts)                         | Times `qc` against a harmonic fit and prediction.                                                                                                                                                 |
| [coops-r.py](coops-r.py)                       | Counts R and F on CO-OPS verified values, and their distance from their neighbors, from CO-OPS's API.                                                                                             |
| [float32.py](float32.py)                       | Checks whether 0.1 mm levels survive the store's 32-bit storage, by elevation.                                                                                                                    |
| [max-level.py](max-level.py)                   | Finds the largest absolute level in every year file of the store, per source, from Parquet footer statistics.                                                                                     |

For example, Jersey 2025:

```bash
python -I docs/qc/scripts/export.py bodc/jer 2025 jer2025.json
node docs/qc/scripts/rerun.ts jer2025.json 2025
python -I docs/qc/scripts/gap-edge.py bodc/jer 2025
node docs/qc/scripts/spike-variants.ts jer2025.json:2025
node docs/qc/scripts/residual-prototype.ts jer2025.json 2025 2025-10-14T18:00/2025-10-14T21:00
```

The station-years in the evaluation are `bodc/jer` 2025, `bodc/npo` and `bodc/liv` 2024 (gap edges only), `marine-institute/kilrush-lough` 2025, `marine-institute/galway-port` 2025, `pegelonline/9420020` and `pegelonline/5950081` 2025 and 2026, `ea/E71924` and `ea/E72039` 2026, `sfwmd/MARKH` 2022, `usace/MVN.Cyremort_Point` 2019, and `coops/8729840` 2020, `coops/8761305` 2020 and 2021, `coops/8735180` 2020, `coops/8761955` 2019 and `coops/8764044` 2019.

Some figures in the evaluation have no script: the source flag shares, summed from `stations/years/<source>.parquet` with `query.py`; the 69 JMA files checked for a 9.99 m sentinel; the check of BODC's ERDDAP for the missing 07:30 row; and the one-off run of `datumJumps` over every coastal record, whose results are the errata's own evidence.
