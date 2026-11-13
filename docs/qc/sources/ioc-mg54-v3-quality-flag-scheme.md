# IOC Manuals and Guides 54, Volume 3: Recommendation for a Quality Flag Scheme (2013)

## Citation

Intergovernmental Oceanographic Commission of UNESCO, 2013. Ocean Data Standards, Vol. 3: Recommendation for a Quality Flag Scheme for the Exchange of Oceanographic and Marine Meteorological Data. IOC Manuals and Guides 54, Vol. 3, Version 1, March 2013. 12 pp. (IOC/2013/MG/54-3). DOI: https://doi.org/10.25607/OBP-6

- Copy read: https://oceanexpert.org/downloadFile/43462 (the cover page says "DRAFT", the inner title page says "UNESCO 2013 ... Version 1 March 2013")
- Record: https://oceanexpert.org/document/10402

## License and local copy

"© UNESCO 2013"; no open license statement. Link only.

## Why it matters

This is the flag scheme U.S. IOOS QARTOD adopted ("UNESCO 2013" in QARTOD Table 3-1). It differs from the SeaDataNet/GLOSS scheme in meaning of 2 and 3.

## Primary level (section 5.1, p. 3, Table 1)

| Value | Short name                              | Definition                                                                             |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| 1     | Good                                    | Passed documented required QC tests                                                    |
| 2     | Not evaluated, not available or unknown | Used for data when no QC test performed or the information on quality is not available |
| 3     | Questionable/suspect                    | Failed non-critical documented metric or subjective test(s)                            |
| 4     | Bad                                     | Failed critical documented QC test(s) or as assigned by the data provider              |
| 9     | Missing data                            | Used as place holder when data are missing                                             |

"Increasing flag values indicate decreasing data quality." "Not evaluated" sits between good and suspect because unevaluated data "could turn out to be of any quality". Derived values inherit the worst flag of their inputs.

## Secondary level (section 5.2, pp. 4-5)

Optional, implementer-defined codes that record which tests ran and processing history (examples: globally impossible value, climatology SD test, excessive spike, offset versus reference, interpolated value, offset-corrected value, expert review). Recommended to explain primary flags.
