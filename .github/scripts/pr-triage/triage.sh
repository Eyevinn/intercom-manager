#!/usr/bin/env bash
#
# pr-triage — categorize open pull requests by type/risk so a human can see
# at a glance which PRs are safe to fast-track vs which need a real review.
#
# This is the executable half of the "PR review triage" skill (see README.md).
# It is intentionally READ-ONLY: it inspects open PRs and prints a grouped
# report. It does not apply labels, merge, or otherwise mutate the repository,
# and it does not encode any review cadence or SLA (that is a team decision —
# see issue #320).
#
# Categorization is purely mechanical and derived from signals that already
# exist in this repo:
#   - author is the dependabot bot            -> dependency bump
#   - the `github_actions` label is present   -> CI/Actions dependency bump
#   - the `security` label is present         -> security change
#   - the PR is a draft                       -> work in progress
#   - anything else                           -> code change needing full review
#
# Dependabot is configured (.github/dependabot.yml) to ignore semver-major
# updates, so npm dependency bumps here are minor/patch and are treated as
# fast-track candidates — unless they also carry the `security` label.
#
# Usage:
#   .github/scripts/pr-triage/triage.sh [--repo OWNER/NAME] [--limit N] [--json]
#
# Requires: gh (authenticated) and jq.

set -euo pipefail

REPO=""
LIMIT=100
OUTPUT="text"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      REPO="$2"; shift 2 ;;
    --limit)
      LIMIT="$2"; shift 2 ;;
    --json)
      OUTPUT="json"; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

for bin in gh jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is required but not installed" >&2
    exit 1
  fi
done

repo_args=()
if [ -n "$REPO" ]; then
  repo_args=(--repo "$REPO")
fi

# Fetch open PRs with the fields we categorize on.
prs_json="$(gh pr list "${repo_args[@]}" --state open --limit "$LIMIT" \
  --json number,title,author,labels,isDraft,createdAt,url)"

# Annotate every PR with a bucket + priority using mechanical rules only.
# priority ordering (for sorting within the report): 1=security, 2=code,
# 3=ci-deps, 4=npm-deps, 5=draft.
annotated="$(printf '%s' "$prs_json" | jq '
  def has_label($n): any(.labels[]?; .name == $n);
  def is_dependabot: (.author.is_bot == true)
    and ((.author.login // "") | ascii_downcase | contains("dependabot"));
  def age_days: ((now - (.createdAt | fromdateiso8601)) / 86400) | floor;
  [ .[] | . + (
      if .isDraft == true then
        { bucket: "draft", label: "Work in progress (draft)", priority: 5, risk: "n/a — not ready" }
      elif has_label("security") then
        { bucket: "security", label: "Security — needs prompt review", priority: 1, risk: "HIGH" }
      elif is_dependabot and has_label("github_actions") then
        { bucket: "ci-deps", label: "CI / GitHub Actions dependency bump", priority: 3, risk: "LOW — fast-track candidate" }
      elif is_dependabot then
        { bucket: "npm-deps", label: "npm dependency bump", priority: 4, risk: "LOW — fast-track candidate" }
      else
        { bucket: "code", label: "Code change — needs full review", priority: 2, risk: "REVIEW REQUIRED" }
      end
    ) + { ageDays: age_days }
  ] | sort_by(.priority, .ageDays * -1)
')"

if [ "$OUTPUT" = "json" ]; then
  printf '%s\n' "$annotated"
  exit 0
fi

total="$(printf '%s' "$annotated" | jq 'length')"

echo "==================================================================="
echo " PR review triage  —  $total open PR(s)"
echo " generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==================================================================="
echo
echo "Legend: priority order is Security -> Code review -> CI deps ->"
echo "        npm deps -> Drafts. 'Fast-track candidate' means mechanically"
echo "        low-risk (minor/patch dependency bump); it is NOT an approval."
echo

print_bucket() {
  bucket_key="$1"; heading="$2"
  rows="$(printf '%s' "$annotated" | jq -r --arg b "$bucket_key" '
    [ .[] | select(.bucket == $b) ]
    | if length == 0 then empty
      else .[] | "  #\(.number)  [\(.risk)]  \(.title)  (\(.ageDays)d old)\n      \(.url)"
      end')"
  if [ -n "$rows" ]; then
    echo "-------------------------------------------------------------------"
    echo "$heading"
    echo "-------------------------------------------------------------------"
    printf '%s\n\n' "$rows"
  fi
}

print_bucket "security" "SECURITY — review first"
print_bucket "code"     "CODE CHANGES — need a real review"
print_bucket "ci-deps"  "CI / ACTIONS DEPENDENCY BUMPS — low risk, fast-track candidates"
print_bucket "npm-deps" "NPM DEPENDENCY BUMPS — low risk, fast-track candidates"
print_bucket "draft"    "DRAFTS — not ready for review"
