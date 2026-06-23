---
title: "Catalog Updater"
description: "Reference for the plugin catalog updater: the scheduled hub workflow, the composite action, and the verify-first re-pin engine."
diataxis_type: reference
diataxis_describes: "inputs, permissions, behavior, and configuration for the plugin-catalog-update-hub workflow and plugin-catalog-update composite action"
---

The catalog updater is a verify-first analog to Dependabot for Claude Code plugin marketplaces. It resolves each external plugin entry to its latest release, verifies that release's attestations fail-closed, and opens a zero-touch auto-merge PR in the target repo. A release that fails attestation verification is skipped and logged; it is never re-pinned.

The system has three parts:

| Component | Role |
|-----------|------|
| `plugin-catalog-update-hub.yml` | Scheduled hub: discover target marketplace repos → matrix → per-repo update run |
| `.github/actions/plugin-catalog-update/` | Composite action and Python engine (`catalog_update.py`): resolve release, verify-first, re-pin, open PR, auto-merge. `verify` mode is shared by `catalog-admission`. |
| `catalog-update/deny-list.yaml` | Optional safety valve — repos the hub must never touch |

---

## plugin-catalog-update-hub.yml

Runs on a Monday schedule (cron `37 6 * * 1`) and via `workflow_dispatch`. Discovers all marketplace repos accessible to the `attested-delivery-ci` App, excludes repos in `deny-list.yaml`, excludes repos without `.claude-plugin/marketplace.json`, and fans out a matrix of per-repo update jobs.

**Opt-in mechanism:** installing the `attested-delivery-ci` App on a repo opts it into discovery. Uninstalling the App, or adding the `owner/repo` to `deny-list.yaml`, opts it out. There is no additional registry to maintain.

### Triggers

| Event | Notes |
|-------|-------|
| `schedule` | `37 6 * * 1` — Mondays, scattered minute (never `:00`) |
| `workflow_dispatch` | Supports `dry-run` and `repo` inputs |

### Workflow dispatch inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `dry-run` | boolean | `false` | Resolve, verify, and render the PR body to the run log, but open and merge nothing |
| `repo` | string | `''` | Limit the run to a single `owner/repo` |

### Permissions

Top-level `contents: read`. The `discover` job needs only `contents: read`; write operations are performed by the App token, not the workflow's `GITHUB_TOKEN`.

### Authentication

The hub authenticates as the `attested-delivery-ci` GitHub App. The App client id (`Iv23liQchSZyQeuGkhWi`) is a public identifier pinned directly in the workflow. The only credential in org config is the private key, stored as an org secret:

```bash
gh secret set CATALOG_UPDATER_APP_PRIVATE_KEY --org attested-delivery \
  --visibility selected --repos .github < ~/.secrets/attested-delivery-ci.pem
```

The App installation token is minted per-job and scoped to the target repo (least privilege).

### Allow-list entries required

`actions/create-github-app-token` — GitHub-created, confirm it is permitted.

### Dry run

```bash
gh workflow run plugin-catalog-update-hub.yml -f dry-run=true
```

---

## plugin-catalog-update (composite action)

The shared engine used by both the hub (`mode: update`) and `catalog-admission` (`mode: verify`). Implemented as a composite action wrapping `catalog_update.py` (stdlib Python, shells to `gh`).

**Location:** `.github/actions/plugin-catalog-update/action.yml`

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `mode` | no | `update` | `update` (resolve latest release, verify attestations, re-pin, open PR) or `verify` (fail-closed verify of the currently pinned ref only) |
| `repo` | yes | — | `owner/repo` of the marketplace being processed |
| `marketplace-path` | no | `.claude-plugin/marketplace.json` | Path to `marketplace.json` within the checkout |
| `predicate-types` | no | `https://slsa.dev/provenance/v1` | Required predicates: one `"<uri> [signer-workflow]"` per line. Empty fails closed. |
| `github-token` | yes | — | Token for `gh` (App installation token in the hub; `GITHUB_TOKEN` in admission) |
| `dry-run` | no | `false` | Resolve, verify, and render but open and merge nothing |

### Mode: update

For each external plugin entry in `marketplace.json`:

1. Resolve the source repo's latest release (`releases/latest`). Entries with no release are skipped.
2. Dereference the release tag to a commit SHA (`commits/<tag>` — handles annotated tags). Entries already at the latest SHA are skipped.
3. Verify the release's attestations fail-closed (`gh attestation verify`). Every required predicate must verify; a release that fails is skipped and logged.
4. Re-pin `source.sha` and `source.ref` (surgical text edit — formatting preserved).
5. Open an auto-merge PR in the target repo on branch `deps/external-plugin/<name>`. The PR body carries the full attestation evidence.

The target repo's `catalog-admission` gate re-verifies on the PR and is the merge control.

### Mode: verify

Fail-closed verification of every external entry at its currently pinned ref. Used by `catalog-admission` workflows in target repos. Exits non-zero if any entry's attestations do not verify.

### Required predicates

The `predicate-types` input accepts one predicate specification per line in the form:

```
<uri> [signer-workflow]
```

The default is SLSA build provenance verified by `--repo`:

```
https://slsa.dev/provenance/v1
```

To require seam-signed gate verdicts, add lines with the signer workflow:

```
https://slsa.dev/provenance/v1
https://attested-delivery.github.io/attestations/sast/v1 attested-delivery/.github/.github/workflows/reusable-attest-scan.yml
https://attested-delivery.github.io/attestations/sca/v1 attested-delivery/.github/.github/workflows/reusable-attest-scan.yml
```

The same set should be required in the target's `catalog-admission` so the hub and the gate agree.

### Zero-touch auto-merge ruleset bypass

On each target repo: configure the `attested-delivery-ci` App actor to bypass the required human review rule on `deps/external-plugin/*` branches, while keeping `catalog-admission` and the required quality gates as required checks. The fail-closed gate is then the sole merge control.

---

## deny-list.yaml

Location: `catalog-update/deny-list.yaml` in the `.github` repo.

Format: a YAML list under a `deny:` key. One `owner/repo` per entry.

```yaml
deny:
  - attested-delivery/example-repo
```

Repos on the deny-list are skipped by the hub during discovery, even when the App is installed. Use this as a safety valve when the App is installed org-wide but a specific repo should not receive automated catalog updates.

---

## See also

- [CI and Pinning Workflows](/docs/reference/ci-and-pinning-workflows/) — `pin-check`, `actionlint`, `catalog-check`
- [Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/) — the seam and fail-closed verify
- [How-to: Onboard a repo](/docs/guides/onboard-a-repo/)
- [Concept: Attestations that survive promotion](/docs/concepts/03-attestations-that-survive-promotion/)
- [Concept: Enforce at admission, not by convention](/docs/concepts/04-enforce-at-admission-not-by-convention/)
