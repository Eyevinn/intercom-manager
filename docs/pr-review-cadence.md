# PR Review Cadence & SLA

This document records the team's agreement on **how often** open pull requests
are reviewed and **how quickly** a review is expected, so contributors know when
to expect feedback and reviewers have a shared target.

> **Status: proposal.** The cadence and the specific response times below are a
> starting proposal for a small team. The team confirms or adjusts the numbers
> and then announces the adopted version. Until then, treat the numbers as the
> working default.

Motivation: open PRs have accumulated without a clear, communicated review
rhythm (see [#297](https://github.com/Eyevinn/intercom-manager/issues/297),
unreviewed open-PR backlog). A documented, followed cadence keeps lead time
low and stops PRs going stale.

## Review cadence

- **Weekly triage.** All open PRs are triaged every **Monday**. Triage means
  each open PR is categorized (security / code change / dependency bump / draft)
  and either reviewed in the same pass or explicitly queued with an owner and a
  target date. No open PR leaves a Monday triage uncategorized.
- **Continuous for urgent work.** Security fixes and release blockers are not
  held for the weekly pass — see the SLAs below.

## Response-time SLAs

Times are measured from when a PR is opened (or marked ready for review, for
drafts) to a reviewer's first **decision** (see "What counts as reviewed").
"Business days" excludes weekends and public holidays.

| PR category                          | First-review SLA (proposed) |
| ------------------------------------ | --------------------------- |
| Security fix (`security` label)      | within **24 hours**         |
| Release blocker                      | within **24 hours**         |
| Normal code change                   | within **2 business days**  |
| Dependency bump (npm / GitHub Actions) | within **5 business days** |
| Draft PR                             | no SLA until marked ready   |

Rationale for the dependency-bump window: `.github/dependabot.yml` ignores
major npm updates and batches bumps weekly, so these are low-risk and can ride
the weekly triage rather than needing a fast turnaround. A dependency PR that
also carries the `security` label is treated as a security fix (24h).

## What counts as "reviewed"

A PR is reviewed only when a reviewer records a **decision** on it:

- **Approve**, or
- **Request changes** (with actionable comments).

A drive-by comment with no approve/request-changes state does **not** satisfy
the SLA — the clock keeps running until a decision is recorded. After changes
are requested, the same SLAs apply to each subsequent re-review request.

## How automation already helps

The team already has tooling that contributes to this cadence; the SLAs above
sit on top of it rather than replacing it:

- **Manual PR triage skill** —
  [`.github/scripts/pr-triage/triage.sh`](../.github/scripts/pr-triage/triage.sh)
  is a read-only script a maintainer or agent runs on demand to group open PRs
  by type and risk (security first, then code changes, then dependency bumps,
  then drafts). It makes the Monday triage fast; it does not approve or merge
  anything. See its [README](../.github/scripts/pr-triage/README.md).
- **`daily-backlog-pr` pipeline** — the team's scheduled backlog/PR automation
  reviews board-tracked PRs on Project #48 and sweeps orphan and stale PRs on
  each run. This provides a near-daily safety net between Monday triages, but it
  covers PRs tracked on the board; the weekly triage and the SLAs above exist to
  cover **all** open PRs, including those the pipeline does not pick up.

Automation categorizes and surfaces PRs. A human still records the approve /
request-changes decision and decides whether to merge.

## Keeping this followed

- The weekly Monday triage is the checkpoint that this cadence is actually being
  followed; anything breaching its SLA is flagged there with an owner.
- If the numbers prove unrealistic in practice, change them here in a PR rather
  than silently ignoring them, and re-announce the update.
