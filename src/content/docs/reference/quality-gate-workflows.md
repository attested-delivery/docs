---
title: "Quality Gate Workflows"
description: "Reference for the twelve central reusable quality-gate workflows: SAST, SCA, IaC, secrets, posture, DAST, and load."
diataxis_type: reference
diataxis_describes: "workflow_call contracts, inputs, permissions, and predicate types for the twelve quality-gate reusable workflows"
---

Each workflow in this page produces SARIF evidence (or a JSON report) that is signed as a digest-bound attestation by the [attestation seam](/docs/reference/signing-and-verification-workflows/#reusable-attest-scanyml). All SARIF findings land in the GitHub code-scanning Security tab; the code-scanning required check is the merge gate for soft-fail workflows.

**Predicate namespace:** `https://attested-delivery.github.io/attestations/<gate>/v1`

**Calling convention:** reference every workflow by the `.github` repo's full 40-char commit SHA:

```yaml
uses: attested-delivery/.github/.github/workflows/<name>.yml@<sha> # vX.Y.Z
```

Resolve the SHA at use time (`gh api repos/attested-delivery/.github/git/ref/tags/<tag>`). `pin-check` enforces SHA-pinning on every caller.

---

## reusable-sast-codeql.yml

SAST via CodeQL code scanning. Builds a CodeQL database and runs security queries, emitting merged SARIF 2.1.0 into the code-scanning hub and uploading a `sast-sarif` artifact for the seam.

**Predicate type:** `https://attested-delivery.github.io/attestations/sast/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `languages` | string | yes | — | Comma-separated CodeQL languages (e.g. `javascript-typescript,python`) |
| `build-mode` | string | no | `none` | CodeQL build mode: `none`, `autobuild`, or `manual` |
| `config-file` | string | no | `''` | Optional path to a `codeql-config.yml` |
| `queries` | string | no | `''` | Optional query suite (e.g. `security-extended`) |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `sast-sarif` |
| `sarif-filename` | `results.sarif` |

### Required caller permissions

```yaml
permissions:
  security-events: write
  contents: read
  actions: read
```

### Allow-list entries required

`github/codeql-action` (confirm it is permitted in the org allow-list before use).

### Minimal caller snippet

```yaml
jobs:
  sast:
    permissions:
      security-events: write
      contents: read
      actions: read
      packages: read
    uses: attested-delivery/.github/.github/workflows/reusable-sast-codeql.yml@<sha>
    with:
      languages: 'javascript-typescript,python'
```

---

## reusable-sca-osv.yml

Software composition analysis via OSV-Scanner and GitHub dependency review. Runs two complementary layers: OSV-Scanner produces SARIF uploaded to code scanning and the `OSV Scanner SARIF file` artifact; dependency-review blocks PRs that introduce vulnerable or disallowed-license dependencies.

**Predicate type:** `https://attested-delivery.github.io/attestations/sca/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `fail-on-severity` | string | no | `high` | Dependency-review threshold: `low`, `moderate`, `high`, or `critical` |
| `scan-args` | string | no | `--recursive\n./` | OSV-Scanner arguments (block scalar) |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `OSV Scanner SARIF file` |
| `sarif-filename` | `results.sarif` |

### Required caller permissions

```yaml
permissions:
  actions: read
  contents: read
  security-events: write
  pull-requests: write
```

The `dependency-review` job runs only on `pull_request` events.

### Allow-list entries required

`google/osv-scanner-action/*` (the subpath form).

### Minimal caller snippet

```yaml
jobs:
  sca:
    permissions:
      actions: read
      contents: read
      security-events: write
      pull-requests: write
    uses: attested-delivery/.github/.github/workflows/reusable-sca-osv.yml@<sha>
    with:
      fail-on-severity: high
```

---

## reusable-trivy.yml

Container image vulnerability scan, IaC misconfiguration scan, and license scan via Trivy. The IaC+license job is soft-fail (code-scanning check is the gate); the image job is fail-closed on findings at or above `severity`.

**Predicate types (seam-assigned by caller):**
- IaC+license: `https://attested-delivery.github.io/attestations/iac-license/v1`
- Container image: caller-assigned predicate for the image SARIF

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `image-ref` | string | no | `''` | Image to scan by digest; empty skips the image job |
| `severity` | string | no | `HIGH,CRITICAL` | Severities to report and fail on |
| `scan-iac` | boolean | no | `true` | Scan the repo for IaC misconfiguration and license issues |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `iac-license-sarif` |
| `sarif-filename` | `trivy-iac-license.sarif` |
| `image-sarif-artifact` | `container-scan-sarif` (when `image-ref` is set) |
| `image-sarif-filename` | `trivy-image.sarif` (when `image-ref` is set) |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
  actions: read
```

The `image` job additionally needs `packages: read`.

### Allow-list entries required

`aquasecurity/trivy-action` — release-critical. A caller's release fails at startup if this action is not on the org allow-list.

### Minimal caller snippet

```yaml
jobs:
  trivy:
    permissions:
      contents: read
      security-events: write
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-trivy.yml@<sha>
    with:
      image-ref: ghcr.io/attested-delivery/app@sha256:...  # omit to scan repo only
```

---

## reusable-checkov.yml

IaC policy-as-code via Checkov (graph-based, complements Trivy). Soft-fail; findings land in code scanning under the `checkov-iac-policy` category. Installs Checkov via `pip` into an isolated virtualenv — no third-party action; no allow-list entry required.

**Predicate type:** `https://attested-delivery.github.io/attestations/iac-policy/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `directory` | string | no | `.` | Directory to scan |
| `framework` | string | no | `terraform` | Checkov framework(s) to run (e.g. `terraform`, `terraform_plan`) |
| `checkov-version` | string | no | `3.2.524` | Exact Checkov version to install (pinned, no range) |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `iac-policy-sarif` |
| `sarif-filename` | `checkov-iac-policy.sarif` |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
  actions: read
```

### Allow-list entries required

None — all actions are GitHub-created.

### Minimal caller snippet

```yaml
jobs:
  checkov:
    permissions:
      contents: read
      security-events: write
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-checkov.yml@<sha>
    with:
      directory: .
```

---

## reusable-scorecard.yml

OpenSSF Scorecard supply-chain posture analysis. Scores 0–10 heuristics (Branch-Protection, Code-Review, Token-Permissions, Dangerous-Workflow, Pinned-Dependencies, Signed-Releases, …) and uploads SARIF to code scanning. With `publish-results: true`, results are published to the OpenSSF REST API.

This is a **repo-level posture signal**, not an artifact verdict.

Recommended caller triggers: `branch_protection_rule`, `schedule` (weekly), and `push` to the default branch.

**Predicate type:** `https://attested-delivery.github.io/attestations/scorecard/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `publish-results` | boolean | no | `true` | Publish to the OpenSSF API (public repos only) |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `scorecard-sarif` |
| `sarif-filename` | `scorecard.sarif` |

### Required caller permissions

```yaml
permissions:
  security-events: write
  id-token: write
  contents: read
  actions: read
```

`id-token: write` is required to publish results to the OpenSSF API.

### Allow-list entries required

`ossf/scorecard-action`.

### Minimal caller snippet

```yaml
jobs:
  scorecard:
    permissions:
      security-events: write
      id-token: write
      contents: read
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-scorecard.yml@<sha>
```

---

## reusable-shellcheck.yml

SAST for shell scripts (plugin hooks) via Red Hat Differential ShellCheck (full-tree mode). Plugin hooks run with full user privileges; this gate produces SARIF that feeds the seam as a `shellcheck/v1` verdict.

**Predicate type:** `https://attested-delivery.github.io/attestations/shellcheck/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `strict-on-push` | boolean | no | `false` | Fail the job on ShellCheck defects for push events |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `sast-hooks-sarif` |
| `sarif-filename` | `shellcheck.sarif` |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
```

### Allow-list entries required

`redhat-plumbers-in-action/*` — must be added before a caller runs this gate.

### Minimal caller snippet

```yaml
jobs:
  shellcheck:
    permissions:
      contents: read
      security-events: write
    uses: attested-delivery/.github/.github/workflows/reusable-shellcheck.yml@<sha>
```

---

## reusable-semgrep.yml

SAST for bundled MCP-server and plugin source code via Semgrep. Detects command injection, `eval`/`new Function`, `os.system`, `subprocess shell=True`, unsafe deserialization, and similar patterns. Soft-fail; findings land in code scanning under the `semgrep` category. Installs Semgrep via `pip` in an isolated virtualenv — no third-party action; no allow-list entry required.

**Predicate type:** `https://attested-delivery.github.io/attestations/semgrep/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `directory` | string | no | `.` | Directory to scan |
| `config` | string | no | `p/security-audit p/secrets p/command-injection` | Semgrep rule configs, space-separated |
| `semgrep-version` | string | no | `1.139.0` | Exact Semgrep version to install (pinned, no range) |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `sast-code-sarif` |
| `sarif-filename` | `semgrep.sarif` |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
  actions: read
```

### Allow-list entries required

None — pip-installed in an isolated virtualenv; GitHub-created actions only.

### Minimal caller snippet

```yaml
jobs:
  semgrep:
    permissions:
      contents: read
      security-events: write
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-semgrep.yml@<sha>
    with:
      directory: .
```

---

## reusable-secrets.yml

Secret scanning via Gitleaks and TruffleHog. Gitleaks is soft-fail (SARIF to code scanning is the gate); TruffleHog runs in verified-only mode and **hard-fails** when it confirms a live secret. Both tools install as checksum-verified release binaries — no third-party action; no allow-list entry required.

**Predicate type (Gitleaks SARIF):** `https://attested-delivery.github.io/attestations/secrets/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `directory` | string | no | `.` | Directory to scan |
| `gitleaks-version` | string | no | `8.30.1` | Pinned Gitleaks version (no `v` prefix) |
| `trufflehog-version` | string | no | `3.95.6` | Pinned TruffleHog version (no `v` prefix) |
| `fail-on-verified` | boolean | no | `true` | Fail the job if TruffleHog confirms a verified live secret |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `secrets-sarif` |
| `sarif-filename` | `gitleaks.sarif` |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
  actions: read
```

### Allow-list entries required

None — both tools are checksum-verified release binaries; GitHub-created actions only.

### Minimal caller snippet

```yaml
jobs:
  secrets:
    permissions:
      contents: read
      security-events: write
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-secrets.yml@<sha>
    with:
      directory: .
```

---

## reusable-manifest-review.yml

Declarative-constituent integrity gate. Reviews the marketplace catalog (`marketplace.json`) and plugin manifests (`plugin.json`) for structural invariants: every external plugin source is pinned to a 40-char SHA, the marketplace `name` is not Anthropic-reserved, and required fields are present. Soft-fail; implemented as pure stdlib Python — no install, no third-party action, no allow-list entry required.

**Predicate type:** `https://attested-delivery.github.io/attestations/manifest/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `directory` | string | no | `.` | Repo root to review |

### Outputs

| Name | Value |
|------|-------|
| `sarif-artifact` | `manifest-sarif` |
| `sarif-filename` | `manifest-review.sarif` |

### Required caller permissions

```yaml
permissions:
  contents: read
  security-events: write
  actions: read
```

### Allow-list entries required

None — pure stdlib Python; GitHub-created actions only.

### Minimal caller snippet

```yaml
jobs:
  manifest-review:
    permissions:
      contents: read
      security-events: write
      actions: read
    uses: attested-delivery/.github/.github/workflows/reusable-manifest-review.yml@<sha>
    with:
      directory: .
```

---

## reusable-zap.yml

DAST via OWASP ZAP full scan (spider + active scan) against a running target. The JSON report is uploaded as the `dast-report` artifact for the seam. Caller must stand up the target before invoking.

**Predicate type:** `https://attested-delivery.github.io/attestations/dast/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `target` | string | yes | — | URL of the running target to scan |
| `fail-action` | boolean | no | `true` | Fail the job when ZAP reports alerts |
| `cmd-options` | string | no | `-a` | Additional ZAP command-line options |

### Outputs

| Name | Value |
|------|-------|
| `report-artifact` | `dast-report` |
| `report-filename` | `report_json.json` |

### Required caller permissions

```yaml
permissions:
  contents: read
```

### Allow-list entries required

`zaproxy/action-full-scan`.

### Minimal caller snippet

```yaml
jobs:
  gate-dast:
    permissions:
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-zap.yml@<sha>
    with:
      target: https://staging.example.com
```

---

## reusable-k6.yml

Load and performance gate via Grafana k6. The gate is k6's thresholds: a threshold breach causes k6 to exit 99 (`ThresholdsHaveFailed`), failing the job. When `attest: true`, the JSON summary is signed as a custom performance attestation bound to the subject.

**Predicate type (when `attest: true`):** `https://attested-delivery.github.io/attestations/k6-load/v1`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `script-path` | string | yes | — | Path to the k6 test script |
| `attest` | boolean | no | `false` | Sign the k6 summary as a custom performance attestation |
| `subject-name` | string | no | `''` | Subject name for the attestation (required when `attest: true`) |
| `subject-digest` | string | no | `''` | Subject digest for the attestation (required when `attest: true`) |

### Required caller permissions

```yaml
permissions:
  id-token: write
  attestations: write
  contents: read
```

`id-token: write` and `attestations: write` are only consumed when `attest: true`.

### Allow-list entries required

`grafana/setup-k6-action`, `grafana/run-k6-action`.

### Minimal caller snippet

```yaml
jobs:
  load:
    permissions:
      id-token: write
      attestations: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-k6.yml@<sha>
    with:
      script-path: tests/load.js
      attest: true
      subject-name: my-app
      subject-digest: ${{ needs.build.outputs.digest }}
```

---

## reusable-vex.yml

OpenVEX vulnerability disposition. Normalizes an OpenVEX document with `vexctl merge` and signs it as an attestation bound to the artifact digest. Enables deploy gates to enforce "no undispositioned high/critical" rather than "zero findings". Self-signs — verify with `--signer-workflow .../reusable-vex.yml`, not the seam.

**Predicate type (self-signed):** `https://openvex.dev/ns/v0.2.0`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `subject-name` | string | yes | — | Subject the OpenVEX statement is bound to |
| `subject-digest` | string | yes | — | Subject digest (`sha256:...`) |
| `vex-path` | string | no | `.vex/openvex.json` | Path to the OpenVEX document in the repository |
| `vexctl-version` | string | no | `v0.4.1` | `vexctl` module version to install |

### Required caller permissions

```yaml
permissions:
  id-token: write
  attestations: write
  contents: read
```

### Allow-list entries required

None beyond GitHub-created `actions/setup-go`, `actions/attest`, and `actions/checkout`.

### Minimal caller snippet

```yaml
jobs:
  vex:
    needs: [build]
    permissions:
      id-token: write
      attestations: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-vex.yml@<sha>
    with:
      subject-name: ghcr.io/attested-delivery/app
      subject-digest: ${{ needs.build.outputs.digest }}
      vex-path: .vex/openvex.json
```

---

## See also

- [Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/) — the attestation seam and fail-closed verify
- [CI and Pinning Workflows](/docs/reference/ci-and-pinning-workflows/) — `pin-check`, `actionlint`, `catalog-check`
- [How-to: Onboard a repo](/docs/guides/onboard-a-repo/)
- [How-to: Verify a release](/docs/guides/verify-a-release/)
- [Concept: Attestations that survive promotion](/docs/concepts/03-attestations-that-survive-promotion/)
- [Concept: Enforce at admission, not by convention](/docs/concepts/04-enforce-at-admission-not-by-convention/)
- [Concept: SLSA L3 is nearly free](/docs/concepts/05-slsa-l3-is-nearly-free/)
