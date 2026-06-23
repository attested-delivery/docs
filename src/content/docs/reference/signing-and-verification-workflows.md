---
title: "Signing and Verification Workflows"
description: "Reference for the five central signing and verification workflows: the attestation seam, fail-closed gate verify, container signing, cross-hop verify, and blob signing."
diataxis_type: reference
diataxis_describes: "workflow_call contracts, inputs, permissions, predicate types, and signer identities for signing and verification reusable workflows"
---

These workflows form the trust enforcement spine of the attested-delivery architecture. The attestation seam turns gate evidence into enforceable claims; the verification workflows fail closed if claims do not verify before deployment.

**Signing identity model (SLSA Build L3):** Under SLSA L3 the Fulcio SAN is the *signer workflow*, not the source repo. `--owner` or `--repo` alone is insufficient for seam-signed predicates. Always pin `--signer-workflow` in any `gh attestation verify` call, one signer per command.

**Calling convention:** reference every workflow by the `.github` repo's full 40-char commit SHA:

```yaml
uses: attested-delivery/.github/.github/workflows/<name>.yml@<sha> # vX.Y.Z
```

---

## reusable-attest-scan.yml

The **attestation seam**. Turns any quality gate's evidence file — a SARIF, a JSON report, an OpenVEX document — into a signed, digest-bound in-toto attestation via GitHub keyless signing (`actions/attest`, custom predicate). A clean code-scanning result is evidence; this attestation is the enforceable, verifiable claim bound to a subject by digest and signed by this central workflow's OIDC identity.

**Signer identity (Fulcio SAN):**
`https://github.com/attested-delivery/.github/.github/workflows/reusable-attest-scan.yml@<ref>`

**Predicate type:** caller-specified. Use any URI from the custom predicate namespace or a standard predicate URI.

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `subject-name` | string | yes | Logical subject name (image repo, package name, or artifact label) |
| `subject-digest` | string | yes | Subject digest the predicate is bound to (`sha256:...`) |
| `predicate-type` | string | yes | URI identifying the predicate type (e.g. `https://attested-delivery.github.io/attestations/sast/v1`) |
| `predicate-artifact` | string | yes | Name of the uploaded artifact containing the evidence file |
| `predicate-filename` | string | yes | Evidence filename within the artifact (e.g. `results.sarif`) |

### Required caller permissions

```yaml
permissions:
  id-token: write        # keyless Sigstore signing
  attestations: write    # persist the GitHub artifact attestation
  contents: read
```

### Allow-list entries required

GitHub-created `actions/download-artifact` and `actions/attest` only.

### Verification

```bash
gh attestation verify <subject> \
  --owner attested-delivery \
  --predicate-type https://attested-delivery.github.io/attestations/sast/v1 \
  --signer-workflow attested-delivery/.github/.github/workflows/reusable-attest-scan.yml
```

Replace the predicate type with the gate's predicate URI. Each predicate type requires a separate `gh attestation verify` command.

### Minimal caller snippet

```yaml
jobs:
  attest-sast:
    needs: [build, sast]
    permissions:
      id-token: write
      attestations: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-attest-scan.yml@<sha>
    with:
      subject-name: my-app
      subject-digest: ${{ needs.build.outputs.digest }}
      predicate-type: https://attested-delivery.github.io/attestations/sast/v1
      predicate-artifact: ${{ needs.sast.outputs.sarif-artifact }}
      predicate-filename: ${{ needs.sast.outputs.sarif-filename }}
```

---

## reusable-verify-gates.yml

Fail-closed verification of gate attestations. Runs `gh attestation verify` for each required predicate type against a subject and exits non-zero on any failure. Place in a deploy job's `needs:` to halt an unverified artifact before it ships.

**One signer per invocation.** Different predicates are signed by different workflows — the seam (`reusable-attest-scan.yml`) signs the SARIF gates, `reusable-vex.yml` signs OpenVEX, `reusable-k6.yml` signs performance. Mixing predicates from different signers in a single call will fail closed on a valid artifact. Call this workflow once per signer group.

An empty `predicate-types` input fails closed immediately — the workflow refuses to "verify" with no required predicate.

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `subject-ref` | string | yes | Subject to verify (`oci://...@sha256` or a file path) |
| `owner` | string | yes | Repository owner that produced the attestations |
| `signer-workflow` | string | yes | The single signer workflow for all predicate types in this call (e.g. `attested-delivery/.github/.github/workflows/reusable-attest-scan.yml` for seam-signed gates) |
| `predicate-types` | string | yes | Newline- or whitespace-separated predicate type URIs; at least one required |

### Required caller permissions

```yaml
permissions:
  contents: read
  attestations: read
  packages: read
```

### Allow-list entries required

None — uses the inline `gh` CLI.

### Minimal caller snippet

```yaml
jobs:
  verify-seam:
    permissions:
      contents: read
      attestations: read
      packages: read
    uses: attested-delivery/.github/.github/workflows/reusable-verify-gates.yml@<sha>
    with:
      subject-ref: oci://ghcr.io/attested-delivery/app@sha256:...
      owner: attested-delivery
      signer-workflow: attested-delivery/.github/.github/workflows/reusable-attest-scan.yml
      predicate-types: |-
        https://attested-delivery.github.io/attestations/sast/v1
        https://attested-delivery.github.io/attestations/sca/v1

  verify-vex:
    permissions:
      contents: read
      attestations: read
      packages: read
    uses: attested-delivery/.github/.github/workflows/reusable-verify-gates.yml@<sha>
    with:
      subject-ref: oci://ghcr.io/attested-delivery/app@sha256:...
      owner: attested-delivery
      signer-workflow: attested-delivery/.github/.github/workflows/reusable-vex.yml
      predicate-types: https://openvex.dev/ns/v0.2.0

  deploy:
    needs: [verify-seam, verify-vex]
    # ...
```

---

## sign-and-attest.yml

Sign and attest a built **container image by digest**. This workflow is the SLSA Build L3 isolation boundary: callers invoke it via `uses:` and cannot modify the signing steps, so the provenance signer identity is this central workflow's `job_workflow_ref`, not the caller's. Image-only — not for static artifacts.

Performs: SLSA build provenance (`actions/attest-build-provenance`), keyless cosign signature, CycloneDX SBOM (optional), and a Grype vulnerability scan (optional). Self-verifies SLSA provenance before completing.

**Predicates produced (self-signed):**
- `https://slsa.dev/provenance/v1` (via `actions/attest-build-provenance`, pushed as OCI referrer)
- CycloneDX SBOM (via inline `cosign attest --type cyclonedx`)
- `https://in-toto.io/attestation/vulns/v0.1` (via inline `cosign attest`)

**Signer identity (Fulcio SAN for cosign):**
`^https://github.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `image-name` | string | yes | — | Image repository without tag or digest (e.g. `ghcr.io/attested-delivery/app`) |
| `image-digest` | string | yes | — | Immutable image digest from the caller's build (`sha256:...`) |
| `sbom` | boolean | no | `true` | Generate and attest a CycloneDX SBOM |
| `vuln-scan` | boolean | no | `true` | Generate and attest a Grype vulnerability report |
| `cosign-version` | string | no | `v3.0.6` | cosign release to install |

### Outputs

| Name | Description |
|------|-------------|
| `provenance-verified` | `true` when the in-run `gh attestation verify` of SLSA provenance passed |

### Required caller permissions

Top-level `permissions: {}` in the caller. The internal job `attest` requires:

```yaml
permissions:
  id-token: write       # OIDC token for Sigstore keyless signing
  attestations: write   # persist GitHub artifact attestation
  packages: write       # push referrers to GHCR
  contents: read
```

### Allow-list entries required

`sigstore/cosign-installer`, `docker/login-action`, `anchore/sbom-action`, `anchore/scan-action`. GitHub-created `actions/attest-build-provenance`.

### Verification (post-build)

```bash
# SLSA provenance
gh attestation verify "oci://${IMAGE_REF}" \
  --repo <caller-repo> \
  --signer-workflow attested-delivery/.github/.github/workflows/sign-and-attest.yml \
  --predicate-type https://slsa.dev/provenance/v1

# cosign signature
cosign verify "${IMAGE_REF}" \
  --certificate-identity-regexp '^https://github\.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Minimal caller snippet

```yaml
jobs:
  sign:
    permissions: {}
    uses: attested-delivery/.github/.github/workflows/sign-and-attest.yml@<sha>
    with:
      image-name: ghcr.io/attested-delivery/app
      image-digest: ${{ needs.build.outputs.digest }}
```

---

## verify-attestation.yml

Fail-closed verification of a container image's signature and attestations between registry hops or before deploy. Pins the expected signing identity to `sign-and-attest.yml`. Image-only; reused by promotion pipelines and callable before any deploy.

Verifies: cosign keyless signature, SLSA provenance (`gh attestation verify`), and optionally the CycloneDX SBOM attestation.

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `image-ref` | string | yes | — | Fully-qualified image ref by digest (`registry/repo@sha256:...`) |
| `attestation-repo` | string | yes | — | `owner/repo` that produced the attestation (for `gh attestation verify`) |
| `certificate-identity-regexp` | string | no | `^https://github.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$` | Expected Fulcio cert identity |
| `certificate-oidc-issuer` | string | no | `https://token.actions.githubusercontent.com` | OIDC issuer |
| `signer-workflow` | string | no | `attested-delivery/.github/.github/workflows/sign-and-attest.yml` | Signer workflow for `gh attestation verify` |
| `require-sbom` | boolean | no | `true` | Verify the CycloneDX SBOM attestation |
| `aws-role-arn` | string | no | `''` | If set, assume this role and log into ECR before verifying |
| `aws-region` | string | no | `us-east-1` | AWS region (used when `aws-role-arn` is set) |

### Required caller permissions

Top-level `permissions: {}` in the caller. The internal job `verify` requires:

```yaml
permissions:
  id-token: write
  contents: read
  packages: read
  attestations: read
```

### Allow-list entries required

`sigstore/cosign-installer`, `docker/login-action`. When `aws-role-arn` is set: `aws-actions/configure-aws-credentials`, `aws-actions/amazon-ecr-login`.

### Minimal caller snippet

```yaml
jobs:
  verify:
    permissions: {}
    uses: attested-delivery/.github/.github/workflows/verify-attestation.yml@<sha>
    with:
      image-ref: ghcr.io/attested-delivery/app@sha256:...
      attestation-repo: attested-delivery/my-repo
```

---

## reusable-cosign-sign.yml

Keyless blob signing for plain files (e.g. a `marketplace.json` catalog) that are not registry packages. Signs with Sigstore cosign keyless signing (short-lived Fulcio certificate bound to this workflow's OIDC identity, witnessed in Rekor), then verifies the bundle back in-run (fail-closed). Consumers re-verify with `cosign verify-blob`.

**Signer identity (Fulcio SAN):**
`^https://github\.com/attested-delivery/\.github/\.github/workflows/reusable-cosign-sign\.yml@`

### Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `blob-path` | string | yes | — | Path to the file (blob) to sign |
| `cosign-version` | string | no | `v3.1.1` | Pinned cosign release to install |

### Outputs

| Name | Description |
|------|-------------|
| `bundle-artifact` | Artifact name holding the cosign bundle (`cosign-bundle`) |
| `bundle-filename` | cosign bundle filename within the artifact (e.g. `marketplace.json.cosign.bundle`) |
| `certificate-identity` | Regex matching the keyless signer identity for use in `cosign verify-blob` by consumers |

### Required caller permissions

```yaml
permissions:
  id-token: write    # keyless Sigstore signing
  contents: read
```

### Allow-list entries required

`sigstore/cosign-installer`.

### Consumer verification

```bash
cosign verify-blob <blob-path> \
  --bundle <bundle-file> \
  --certificate-identity-regexp '^https://github\.com/attested-delivery/\.github/\.github/workflows/reusable-cosign-sign\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Minimal caller snippet

```yaml
jobs:
  sign-catalog:
    permissions:
      id-token: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-cosign-sign.yml@<sha>
    with:
      blob-path: .claude-plugin/marketplace.json
```

---

## See also

- [Quality Gate Workflows](/docs/reference/quality-gate-workflows/) — the SARIF gates that feed the seam
- [CI and Pinning Workflows](/docs/reference/ci-and-pinning-workflows/) — `pin-check`, `actionlint`, `catalog-check`
- [How-to: Verify a release](/docs/guides/verify-a-release/)
- [How-to: Onboard a repo](/docs/guides/onboard-a-repo/)
- [Concept: Attestations that survive promotion](/docs/concepts/03-attestations-that-survive-promotion/)
- [Concept: Enforce at admission, not by convention](/docs/concepts/04-enforce-at-admission-not-by-convention/)
- [Concept: SLSA L3 is nearly free](/docs/concepts/05-slsa-l3-is-nearly-free/)
