# Decisions

Most decisions in a change are yours to make on the evidence. A short list goes to a maintainer. This guide says which is which, and answers the questions contributors ask most often. If it answers your question, don't ask it: make the decision, and say in the pull request what you decided and why.

Every rule in [Rigor](../../CONTRIBUTING.md#rigor) applies. Most questions are answered by reading it literally, above all "Follow every lead before you ask or stop".

## What a maintainer decides

- A source's terms, a license or a permission that no earlier decision covers. Earlier policy decisions stand ([Rigor](../../CONTRIBUTING.md#rigor)).
- A change to a published file's columns, or to what one of its values means ([`src/store/files.ts`](../../src/store/files.ts)), to the levels API, or to the site's structure.
- A change to a QC rule that applies across stations, or to `cross-check` itself.
- A trade-off in the data where you've read all of it, both answers remain defensible, and users would see the difference.
- Whether a station's values are wrong at all, when you've read all of its data and its neighbors' and the data can't settle it.
- An agency's answer that contradicts the data.
- Sending anything outside the project, such as a report to an agency or a comment on another project's issue. Merging a pull request. Dispatching a workflow that writes to R2. Anything that costs money.

Put an open decision to a maintainer as Rigor says: with the evidence you gathered, the leads you couldn't follow and why, and your recommendation. Put it in the pull request, which stays a draft until it's settled, or in your run report where there's no change to make. For a published file or the API, recommend the option that keeps existing readers working. Sending, merging, dispatching and spending aren't open decisions. They're simply a maintainer's to do, so list them in the description, and leave the pull request ready for review.

## What you decide

Everything else. Below are the answers to the questions that come up most.

### Asking an agency

- **Don't write to an agency yourself, and don't ask whether to.** An error goes in the source's errata, and a question in its `questions`, and `npm run errata` drafts one message per source, to the source's `metadata.contact` ([Source errata](sources.md#source-errata)). Put the draft in your pull request's description. A maintainer sends it when the pull request merges.
- **Don't wait for the answer.** Do what the evidence in hand supports now, choosing the handling that's easiest to undo, such as flagging over dropping. The erratum's `response` or the question's `meanwhile` says what the store does now, and the question's `why` says what the answer would change.
- **A report already sent turns out wrong?** Correct it in the source's next message: set the erratum's `reported` and `report` back to null so `npm run errata` drafts it again, say in its `evidence` what the earlier report got wrong, and open the draft with a line saying which report it corrects. Correcting a figure we sent isn't an open decision.
- **A missing or wrong contact** is a fix to the source's `metadata.contact`, from the agency's own published contact page, cited in a comment beside it ([Adding a source](sources.md#adding-a-source)).

### Handling an error in the data

- **An erratum is justified, but you can't tell which values inside its span are good?** Flag the whole span `suspect` rather than dropping it: a flag can be undone, and a drop can't. The [errata runbook](errata-runbook.md#a-cross-check-finding) says which errors get flagged.
- **Span edges** come from the daily values, not from a finding's dates ([Errata runbook](errata-runbook.md#a-cross-check-finding)).
- **A correction needs an independent source.** A position, clock, datum or unit you correct is confirmed against something the agency didn't produce, such as another agency's record of the same structure, a national inventory or the owner's own page, and cited in the erratum. Something that looks obvious from a station's name or a pattern isn't confirmation. Once it's confirmed, make the correction in the same change, with the migration that refreshes or refetches the stations it affects ([Migrations](operations.md#migrations)).

### Process

- **Another review round?** Follow [Review until it's clean](../../CONTRIBUTING.md#rigor).
- **Part of this change or a follow-up?** Follow [Finish the whole job](../../CONTRIBUTING.md#rigor): only blocked work is a follow-up.

### Wording

Docs, READMEs and errata text are yours. State facts plainly for researchers, and follow [Where facts live](../../CONTRIBUTING.md#where-facts-live).
