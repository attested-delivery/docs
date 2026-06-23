---
title: "CI and Pinning Workflows"
description: "Reference for the three CI integrity workflows: SHA-pin enforcement, workflow-syntax lint, and catalog-completeness check."
diataxis_type: reference
diataxis_describes: "workflow_call contracts, inputs, permissions, and behavior for pin-check, reusable-actionlint, and catalog-check"
---

These workflows enforce supply-chain and catalog integrity as required CI gates. `pin-check` is a required status check in every repo; `reusable-actionlint` validates workflow syntax before merge; `catalog-check` keeps the workflow catalog honest.

**Calling convention:** reference every workflow by the `.github` repo's full 40-char commit SHA:

```yaml
uses: attested-delivery/.github/.github/workflows/<name>.yml@<sha> # vX.Y.Z
```

---

## pin-check.yml

Asserts that every GitHub Actions `uses:` reference in the caller's `.github` directory is pinned to a full 40-character commit SHA. Mutable tags (`@v4`, `@main`) and floating refs (`@master`) fail the run. Exempt from checking: local reusable-workflow calls (`uses: ./...`) and digest-pinned container actions (`uses: docker://...@sha256`).

This is a **required status check** in every repo. No inputs, no outputs, no secrets.

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `scan-dir` | string | no | `.github` | Directory to scan for workflow and action files |

### Required caller permissions

Top-level `permissions: {}`. The internal job `pin-check` needs `contents: read`.

### Allow-list entries required

None beyond GitHub-created `actions/checkout`.

### Job and check context

Job id: `pin-check` / name: `pin-check` → required-check context: `pin-check / pin-check`.

### Minimal caller snippet

```yaml
jobs:
  pin-check:
    uses: attested-delivery/.github/.github/workflows/pin-check.yml@<sha>
```

---

## reusable-actionlint.yml

Workflow-syntax lint via `actionlint`. Downloads the actionlint binary at a pinned version, verifies the download against a SHA-256 digest (fail-closed), and runs it against the caller's workflow files. There is no allow-listed pinned action for actionlint; the verified fetch is centralized here so callers do not reinvent it.

When overriding `version`, the `sha256` input **must** also be updated to match. Resolve the correct digest from the release's `actionlint_<version>_checksums.txt` file; do not rely on a remembered value.

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `version` | string | no | `1.7.7` | actionlint release version (no leading `v`) |
| `sha256` | string | no | `023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757` | SHA-256 of `actionlint_<version>_linux_amd64.tar.gz` — must match `version` |
| `files` | string | no | `''` | Space-separated globs to lint; empty lints all files under `.github/workflows` |

### Required caller permissions

```yaml
permissions:
  contents: read
```

### Allow-list entries required

None beyond GitHub-created `actions/checkout`.

### Minimal caller snippet

```yaml
jobs:
  actionlint:
    permissions:
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-actionlint.yml@<sha>
```

---

## catalog-check.yml

Keeps the workflow catalog (`workflow-catalog.md`) honest against the actual set of reusable workflows in `.github/workflows/`. Enforces two directions:

- **Forward:** every `workflow_call` reusable workflow under `.github/workflows/` must have a matching entry in the catalog.
- **Reverse:** every workflow path the catalog names must resolve to a real file on disk.

This is a **repo-level CI gate** (not a reusable workflow — it has no `workflow_call` trigger). It runs on pull requests and pushes to `main` that touch `.github/workflows/**` or the catalog file.

**Triggers:**

```yaml
on:
  pull_request:
    paths:
      - '.github/workflows/**'
      - '.github/skills/attested-delivery/references/workflow-catalog.md'
  push:
    branches: [main]
    paths:
      - '.github/workflows/**'
      - '.github/skills/attested-delivery/references/workflow-catalog.md'
```

### Permissions

```yaml
permissions:
  contents: read
```

### Behavior

Exits non-zero and emits `::error::` annotations when:
- A `workflow_call` reusable workflow has no catalog entry.
- The catalog names a workflow file that does not exist on disk.

Exits zero with a summary line when all reusables are documented and all catalog entries resolve.

### Allow-list entries required

None beyond GitHub-created `actions/checkout`.

---

## See also

- [Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/) — the attestation seam and fail-closed verify
- [Quality Gate Workflows](/docs/reference/quality-gate-workflows/) — the SARIF gates
- [Catalog Updater](/docs/reference/catalog-updater/) — automated verify-first catalog re-pinning
- [How-to: Onboard a repo](/docs/guides/onboard-a-repo/)
- [Concept: Enforce at admission, not by convention](/docs/concepts/04-enforce-at-admission-not-by-convention/)
