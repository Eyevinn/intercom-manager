# PR review triage skill

A small, self-contained tool that triages the repository's **open pull
requests by type and risk**, so a reviewer can see at a glance which PRs are
safe to fast-track and which need a real review.

This addresses [#319](https://github.com/Eyevinn/intercom-manager/issues/319)
("Create PR review triage workflow or skill") via the issue's "manual skill"
option. It is deliberately **not** a GitHub Actions workflow and **not** a
scheduled bot — it is a script a maintainer (or an agent) runs on demand.

It does **not** define how often PRs are reviewed or any SLA/response-time
target — that is a separate team process decision tracked in
[#320](https://github.com/Eyevinn/intercom-manager/issues/320).

## Usage

```sh
# Triage open PRs in the current repo
.github/scripts/pr-triage/triage.sh

# Target a specific repo / cap the number of PRs fetched
.github/scripts/pr-triage/triage.sh --repo Eyevinn/intercom-manager --limit 100

# Machine-readable output (annotated JSON array)
.github/scripts/pr-triage/triage.sh --json
```

Requirements: an authenticated [`gh`](https://cli.github.com/) CLI and `jq`.

The script is **read-only**. It never applies labels, comments, merges, or
otherwise mutates the repository — it only reads open PRs and prints a report.

## How PRs are categorized

Categorization is purely mechanical and relies on signals that already exist in
this repository (dependabot config and the existing label set). No judgement
about urgency is invented by the script.

| Signal (checked in this order)              | Bucket                               | Risk                         |
| ------------------------------------------- | ------------------------------------ | ---------------------------- |
| PR is a draft                               | Work in progress                     | n/a — not ready              |
| Has the `security` label                    | Security — review first              | HIGH                         |
| Dependabot author + `github_actions` label  | CI / GitHub Actions dependency bump  | LOW — fast-track candidate   |
| Dependabot author (npm)                     | npm dependency bump                  | LOW — fast-track candidate   |
| Everything else                             | Code change — needs full review      | REVIEW REQUIRED              |

Why dependency bumps are treated as low risk: for the npm ecosystem,
`.github/dependabot.yml` ignores `version-update:semver-major` updates, so npm
dependency PRs opened here are minor/patch bumps. The `github-actions`
ecosystem has no such ignore, so GitHub Actions PRs can include major bumps;
these are still typically low-risk. A dependency PR that also carries the `security` label is
escalated to the Security bucket.

"Fast-track candidate" is a mechanical classification, **not** an approval. A
human still decides whether to merge.

## Report shape

PRs are grouped and ordered by priority:

1. Security
2. Code changes needing review
3. CI / Actions dependency bumps
4. npm dependency bumps
5. Drafts

Each entry shows the PR number, risk tag, title, age in days, and URL.
