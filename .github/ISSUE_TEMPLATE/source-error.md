---
name: Source error
about: Something a source publishes is wrong
title: ""
labels: source-error
---

<!-- One sentence: what the source publishes wrong, at which stations. -->

## Evidence

<!-- How it was found and how sure it is: the file or response, a comparison with another record, a clock check. Link fixtures or runs. -->

## Lake

<!-- What the lake does about it (corrected, flagged, dropped, refused, avoided or kept), and the erratum's ID in src/errata.ts. -->

## Report to the agency

- [ ] Draft the report in the agency's language, with the evidence
- [ ] A person approves and sends it; set `reported` in src/errata.ts
- [ ] Record the agency's answer here
- [ ] Once fixed: set `fixed`, remove the workaround, refetch what it touched
