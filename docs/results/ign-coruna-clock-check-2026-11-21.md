# IGN Coruña clock check

Each year of `ign/ACOR1`, 2000 to 2023, cross-correlated with the harmonic prediction from the TICON constants of three records of the gauge, by `npm run clock-check` at lags of up to 3 hours in 10-minute steps. A positive lag means IGN's stamps run late against the prediction. None of the 72 fits is flagged: every best lag is within 10 minutes and every K1 phase within 16 minutes.

| Record | Originator | Best lag 0 min | +10 min | −10 min | K1 phase, mean |
| --- | --- | --: | --: | --: | --: |
| `coruna-coru-esp-ieo` | IEO's Coruña gauge, 0.7 km from IGN's | 19 | 4 | 1 | +4.0 min |
| `la_coruna-830-esp-uhslc_fd` | UHSLC's La Coruña (fast delivery) | 19 | 4 | 1 | +3.6 min |
| `coruna2tg-cor-esp-cmems` | CMEMS's Coruna2TG, named for IGN's ACOR1 | 19 | 2 | 3 | +0.1 min |

The independent reference is IEO's gauge. UHSLC's record may come from IEO, and CMEMS's record is named "A Coruña ACOR1 TG tide gauge" after IGN's code, so it is IGN's own data and its agreement isn't independent evidence.

Comparing hourly levels directly with the store's copy of the CMEMS record from November 2019 to 2023 (32,879 hours in both): r 0.9979 at zero lag, 0.878 with IGN an hour late and 0.871 an hour early. The copy sits 4.981 m above IGN's levels, near IGN's 4.998 m NMMA offset, with a standard deviation of 5.9 cm in the difference. The copy is hourly, so it can't resolve less than an hour.

## Every fit

| Year | Record | Values | r at 0 | Best lag | r at best | K1 lag |
| --: | --- | --: | --: | --: | --: | --: |
| 2000 | `coruna-coru-esp-ieo` | 8,784 | 0.991 | 0 min | 0.991 | -5 min |
| 2000 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.990 | 0 min | 0.990 | -5 min |
| 2000 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.990 | -10 min | 0.991 | -9 min |
| 2001 | `coruna-coru-esp-ieo` | 8,760 | 0.990 | 0 min | 0.990 | 1 min |
| 2001 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.990 | 0 min | 0.990 | 1 min |
| 2001 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.989 | 0 min | 0.989 | -3 min |
| 2002 | `coruna-coru-esp-ieo` | 8,714 | 0.992 | 0 min | 0.992 | 3 min |
| 2002 | `la_coruna-830-esp-uhslc_fd` | 8,714 | 0.992 | 0 min | 0.992 | 3 min |
| 2002 | `coruna2tg-cor-esp-cmems` | 8,714 | 0.992 | 0 min | 0.992 | -1 min |
| 2003 | `coruna-coru-esp-ieo` | 8,760 | 0.993 | 0 min | 0.993 | 3 min |
| 2003 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.992 | 0 min | 0.992 | 2 min |
| 2003 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.991 | -10 min | 0.992 | -1 min |
| 2004 | `coruna-coru-esp-ieo` | 8,784 | 0.990 | -10 min | 0.993 | -5 min |
| 2004 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.990 | -10 min | 0.993 | -5 min |
| 2004 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.987 | -10 min | 0.992 | -9 min |
| 2005 | `coruna-coru-esp-ieo` | 8,733 | 0.992 | 0 min | 0.992 | 5 min |
| 2005 | `la_coruna-830-esp-uhslc_fd` | 8,733 | 0.992 | 0 min | 0.992 | 4 min |
| 2005 | `coruna2tg-cor-esp-cmems` | 8,733 | 0.993 | 0 min | 0.993 | 1 min |
| 2006 | `coruna-coru-esp-ieo` | 8,760 | 0.987 | 10 min | 0.991 | 11 min |
| 2006 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.987 | 10 min | 0.991 | 11 min |
| 2006 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.989 | 10 min | 0.991 | 7 min |
| 2007 | `coruna-coru-esp-ieo` | 8,221 | 0.990 | 10 min | 0.994 | 16 min |
| 2007 | `la_coruna-830-esp-uhslc_fd` | 8,221 | 0.990 | 10 min | 0.994 | 15 min |
| 2007 | `coruna2tg-cor-esp-cmems` | 8,221 | 0.991 | 10 min | 0.992 | 12 min |
| 2008 | `coruna-coru-esp-ieo` | 8,784 | 0.992 | 10 min | 0.993 | 5 min |
| 2008 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.993 | 10 min | 0.993 | 4 min |
| 2008 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.993 | 0 min | 0.993 | 1 min |
| 2009 | `coruna-coru-esp-ieo` | 8,760 | 0.993 | 0 min | 0.993 | 2 min |
| 2009 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.993 | 0 min | 0.993 | 1 min |
| 2009 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.993 | 0 min | 0.993 | -2 min |
| 2010 | `coruna-coru-esp-ieo` | 8,760 | 0.992 | 0 min | 0.992 | 2 min |
| 2010 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.992 | 0 min | 0.992 | 1 min |
| 2010 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.992 | 0 min | 0.992 | -2 min |
| 2011 | `coruna-coru-esp-ieo` | 8,760 | 0.993 | 0 min | 0.993 | -1 min |
| 2011 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.993 | 0 min | 0.993 | -1 min |
| 2011 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.993 | 0 min | 0.993 | -4 min |
| 2012 | `coruna-coru-esp-ieo` | 8,784 | 0.989 | 10 min | 0.991 | 7 min |
| 2012 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.989 | 10 min | 0.990 | 7 min |
| 2012 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.989 | 0 min | 0.989 | 3 min |
| 2013 | `coruna-coru-esp-ieo` | 8,650 | 0.991 | 0 min | 0.991 | 7 min |
| 2013 | `la_coruna-830-esp-uhslc_fd` | 8,650 | 0.991 | 0 min | 0.991 | 6 min |
| 2013 | `coruna2tg-cor-esp-cmems` | 8,650 | 0.991 | 0 min | 0.991 | 3 min |
| 2014 | `coruna-coru-esp-ieo` | 8,723 | 0.992 | 0 min | 0.992 | 9 min |
| 2014 | `la_coruna-830-esp-uhslc_fd` | 8,723 | 0.992 | 0 min | 0.992 | 9 min |
| 2014 | `coruna2tg-cor-esp-cmems` | 8,723 | 0.992 | 0 min | 0.992 | 5 min |
| 2015 | `coruna-coru-esp-ieo` | 8,760 | 0.993 | 0 min | 0.993 | 1 min |
| 2015 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.993 | 0 min | 0.993 | 1 min |
| 2015 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.993 | 0 min | 0.993 | -3 min |
| 2016 | `coruna-coru-esp-ieo` | 8,784 | 0.994 | 0 min | 0.994 | 5 min |
| 2016 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.994 | 0 min | 0.994 | 4 min |
| 2016 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.994 | 0 min | 0.994 | 1 min |
| 2017 | `coruna-coru-esp-ieo` | 8,760 | 0.994 | 0 min | 0.994 | 8 min |
| 2017 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.994 | 0 min | 0.994 | 8 min |
| 2017 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.994 | 0 min | 0.994 | 4 min |
| 2018 | `coruna-coru-esp-ieo` | 8,760 | 0.993 | 0 min | 0.993 | 3 min |
| 2018 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.993 | 0 min | 0.993 | 3 min |
| 2018 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.992 | 0 min | 0.992 | -1 min |
| 2019 | `coruna-coru-esp-ieo` | 8,760 | 0.988 | 0 min | 0.988 | 7 min |
| 2019 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.989 | 0 min | 0.989 | 7 min |
| 2019 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.988 | 0 min | 0.988 | 3 min |
| 2020 | `coruna-coru-esp-ieo` | 8,784 | 0.995 | 0 min | 0.995 | 6 min |
| 2020 | `la_coruna-830-esp-uhslc_fd` | 8,784 | 0.995 | 0 min | 0.995 | 5 min |
| 2020 | `coruna2tg-cor-esp-cmems` | 8,784 | 0.995 | 0 min | 0.995 | 2 min |
| 2021 | `coruna-coru-esp-ieo` | 8,760 | 0.994 | 0 min | 0.994 | 3 min |
| 2021 | `la_coruna-830-esp-uhslc_fd` | 8,760 | 0.994 | 0 min | 0.994 | 3 min |
| 2021 | `coruna2tg-cor-esp-cmems` | 8,760 | 0.993 | 0 min | 0.993 | -1 min |
| 2022 | `coruna-coru-esp-ieo` | 8,727 | 0.993 | 0 min | 0.993 | 2 min |
| 2022 | `la_coruna-830-esp-uhslc_fd` | 8,727 | 0.993 | 0 min | 0.993 | 1 min |
| 2022 | `coruna2tg-cor-esp-cmems` | 8,727 | 0.993 | 0 min | 0.993 | -2 min |
| 2023 | `coruna-coru-esp-ieo` | 8,712 | 0.992 | 0 min | 0.992 | 2 min |
| 2023 | `la_coruna-830-esp-uhslc_fd` | 8,712 | 0.992 | 0 min | 0.992 | 1 min |
| 2023 | `coruna2tg-cor-esp-cmems` | 8,712 | 0.991 | 0 min | 0.991 | -2 min |

Each fit uses a whole year, so a change within a year would show only as a lower zero-lag correlation than a steady clock gives. The correlations are 0.987 to 0.995 in every year. IGN hasn't confirmed its clock convention, so the source's README and the `ign-coruna-clock` erratum say so.

## Stored flags

A local backfill of all 24 years through the registered adapter, then a requalify, stores 209,544 levels: 209,543 good and 1 suspect, with IGN's reviewed source flag 0 on every one.
