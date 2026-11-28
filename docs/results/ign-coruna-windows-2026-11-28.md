# IGN Coruña clock offset spans

IGN's hourly Coruña levels run off two neighboring gauges in eight spans, by 8 to 20 minutes. The store flags those spans `suspect`, one erratum each, and leaves the rest of 2000 to 2023 to ordinary QC.

## Method

Three instruments read this water: IGN's ACOR1, IEO's gauge (UHSLC 830) and Puertos del Estado's REDMAR gauge (`cmems/CorunaTG`); see [the identity report](ign-coruna-identity-2026-11-22.md). [`lags.mjs`](ign-coruna-windows-2026-11-28/lags.mjs) fits each pair to each other for every week and month of 2000 to 2023. It reads the second series between its hours by cubic interpolation at lags of up to 90 minutes, one minute apart, and takes the lag where the difference of the two has the least spread. Its output is [`lags.json`](ign-coruna-windows-2026-11-28/lags.json); a positive lag means the first series of the pair is late.

## Rule

- A week counts where every reference with data puts IGN at least 8 minutes off, in one direction.
- Counting weeks at most 1 week apart form a run.
- A run of 4 or more counting weeks is a span, from the start of its first week to the end of its last.

`lags.mjs` applies the rule and writes the spans into `lags.json`; a test holds the flagged spans to it. The 8-minute and 4-week thresholds are decisions. A 10-minute threshold with the same run rules would drop or shorten several spans. IEO's gauge and REDMAR's differ from each other about as often as IGN differs from IEO, so where both have data, one of them alone does not count against IGN.

## Spans

| Erratum | Span (to before the second date) | IGN against its neighbors | Compared with |
| --- | --- | --- | --- |
| `ign-coruna-clock-2000-10` | 2000-09-30 to 2000-11-04 | 9 to 14 minutes early | IEO |
| `ign-coruna-clock-2000-11` | 2000-11-18 to 2001-01-20 | 9 to 16 minutes early | IEO |
| `ign-coruna-clock-2004-03` | 2004-03-27 to 2004-04-24 | 8 to 9 minutes early | REDMAR |
| `ign-coruna-clock-2004-09` | 2004-09-25 to 2004-11-27 | 9 to 12 minutes early | REDMAR; IEO in one week |
| `ign-coruna-clock-2006-03` | 2006-03-18 to 2006-05-06 | 8 to 15 minutes late | IEO, REDMAR |
| `ign-coruna-clock-2006-11` | 2006-11-25 to 2007-03-10 | 9 to 19 minutes late | IEO, REDMAR |
| `ign-coruna-clock-2007-12` | 2007-12-22 to 2008-01-19 | 8 to 13 minutes late | IEO, REDMAR |
| `ign-coruna-clock-2011-11` | 2011-11-26 to 2012-05-19 | 8 to 20 minutes late | IEO, REDMAR |

From late 2011 the offset against both references grows steadily from 8 minutes to 20 by mid May 2012, then returns to about 0 in the week of 26 May. Against REDMAR the offsets in 2004, 2006 and 2007 also build and end in a step back. This is the shape of a drifting clock that is reset.

At 19 to 20 minutes the difference from a reference has a spread of 11 to 20 cm, and 1.4 to 1.8 cm once the offset is removed. IGN's levels change by 46 cm an hour (RMS), so 10 minutes is about 8 cm.

The spans hold 13,104 of the 209,544 values, and ordinary QC flags one more outside them.

## Outside the spans

- Of 1,147 weeks with REDMAR data, 1,127 fit it within 10 minutes. Two are 13 minutes away, 4 and 11 March 2006, where IEO is only 6 and 7 minutes off.
- Of 20 weeks with IEO's gauge alone, 19 fit within 10 minutes; the week of 6 April 2002 is at −13.
- 11 weeks meet the weekly test in runs too short to make a span: in 2001, 2002, May 2004, July 2005 and September 2006.
- No week with a reference has IGN 25 minutes or more from every one. Eight of 1,253 weeks have no reference.

## Limits

- Offsets continue past some edges. From 24 April to 25 September 2004, 22 weeks, IGN is 7 to 11 minutes early against REDMAR and stays unflagged, because IEO's record is erratic then, up to 55 minutes off REDMAR, and so no week counts. Which of IGN and REDMAR is off in those weeks is not settled.
- Before the spans of March 2006, November 2006 and December 2007, IGN is also 11 to 12 minutes late against REDMAR for some weeks while IEO is under 8 minutes off, so those weeks stay unflagged.
- An unflagged value is not a certified time: the rule asks every reference to agree that IGN is off.
- The references have no certified clocks. IEO's and UHSLC's records are one instrument.
- IGN has not confirmed its historical time convention (`ign-coruna-clock`), and no timestamp is corrected.

## CMEMS copy

CMEMS's `Coruna2TG` is IGN's gauge, but in the weeks starting 3 and 10 August 2020 it runs 31 to 57 minutes late against IGN, REDMAR and IEO alike, and in August and September 2022 up to 34 minutes late against REDMAR, while IGN fits REDMAR and IEO as usual. Its spans, `cmems-coruna-clock-2020` and `cmems-coruna-clock-2022`, are errors of the copy and do not carry to IGN's own record. These copy figures come from the same fit run on the copy, which `lags.mjs` does not include.

## Reproduce

Backfill `ign` into a local store, then:

```bash
node docs/results/ign-coruna-windows-2026-11-28/lags.mjs <store> <output.json>
```

The references are read from the public store, so a later run reflects any change there.
