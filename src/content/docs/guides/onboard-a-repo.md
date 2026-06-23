---
title: "How to Wire Attested Quality Gates into a Repository"
description: "Add the central quality-gate reusables, attestation seam, and fail-closed verify job to a repository so every release ships with signed, verifiable gate verdicts."
diataxis_type: how-to
diataxis_goal: "A repository is onboarded with all in-scope quality gates wired through the attestation seam and a fail-closed verify job blocking deployment of unattested artifacts."
---

This guide walks you through onboarding a repository to the attested quality-gate architecture. When complete, every CI run produces signed, digest-bound attestations for each gate verdict, and your deploy job refuses to proceed without verifying them.

For the rationale behind this architecture, see [The Digest Is the Release](/docs/concepts/01-the-digest-is-the-release) and [Enforce at Admission, Not by Convention](/docs/concepts/04-enforce-at-admission-not-by-convention).

If you prefer an assisted path, the `/gh-attested` skill in Claude Code assesses, plans, and implements this end-to-end for a public open-source repo.

## Prerequisites

- Owner access to the repository and `admin:org` access to the `attested-delivery` org (for allow-list and branch-protection steps)
- The repository's build already pushes a container image by digest, or you are onboarding a binary/bundle release (see step 3 for the distinction)
- The `gh` CLI authenticated to the org

## 1. Resolve the current SHA of the central `.github` repo

Every `uses:` in your caller must pin the central reusable by the full 40-character commit SHA of the `attested-delivery/.github` repository. Tags are mutable and are not acceptable.

```sh
gh api repos/attested-delivery/.github/commits/main --jq .sha
```

Use that SHA — the `attested-delivery/.github` **repository's** commit SHA, not your caller repo's `$GITHUB_SHA` — everywhere `<DOTGITHUB_SHA>` appears below. Add a trailing `# vX.Y.Z` comment with the nearest release tag for human readability.

## 2. Check that the actions you need are on the org allow-list

The org runs a fail-closed Actions allow-list. A caller that references an action not on the allow-list fails at workflow startup with a generic error — not a helpful one. Before adding any gate job, confirm its third-party actions are permitted.

The following actions are commonly needed and **may not yet be on the allow-list**:

- `github/codeql-action` (SAST and SCA gates)
- `google/osv-scanner-action/*` (SCA gate)
- `aquasecurity/trivy-action` (container/IaC/license gate)
- `ossf/scorecard-action` (supply-chain posture gate)
- `zaproxy/*` (DAST gate)
- `sigstore/cosign-installer` (catalog signing)

To add an action, emit the allow-list update for the org owner to apply in the GitHub org settings UI — do not attempt to modify the allow-list programmatically in your CI.

See the `attested-delivery/.github` README for the authoritative allow-list and the known not-yet-added set.

## 3. Create the thin caller workflow

Create `.github/workflows/quality-gates.yml` in your repository. The shape depends on what your build produces.

### If your build produces a container image

Your build job must output the image digest as `image-digest`. Then wire each in-scope gate and the attestation seam:

```yaml
jobs:
  # --- your existing build job that pushes by digest ---
  build:
    outputs:
      image-digest: ${{ steps.push.outputs.digest }}
    # ...

  # --- pin-check: required on every push and PR ---
  pin-check:
    uses: attested-delivery/.github/.github/workflows/pin-check.yml@<DOTGITHUB_SHA> # vX.Y.Z
    permissions:
      contents: read

  # --- SAST gate ---
  sast:
    permissions:
      security-events: write
      contents: read
      actions: read
      packages: read
    uses: attested-delivery/.github/.github/workflows/reusable-sast-codeql.yml@<DOTGITHUB_SHA> # vX.Y.Z
    with:
      languages: javascript-typescript   # adjust for your repo

  # --- Attestation seam: bind the SAST verdict to the image digest ---
  sast-attest:
    needs: [build, sast]
    permissions:
      id-token: write
      attestations: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/reusable-attest-scan.yml@<DOTGITHUB_SHA> # vX.Y.Z
    with:
      subject-name: ghcr.io/attested-delivery/<your-repo>
      subject-digest: ${{ needs.build.outputs.image-digest }}
      predicate-type: https://attested-delivery.github.io/attestations/sast/v1
      predicate-artifact: ${{ needs.sast.outputs.sarif-artifact }}
      predicate-filename: ${{ needs.sast.outputs.sarif-filename }}

  # Repeat the <gate> + <gate>-attest pair for each in-scope gate,
  # swapping predicate-type. See /docs/reference/quality-gate-workflows/
  # for the exact input contract of each gate reusable.

  # --- Fail-closed verify: seam-signed gates ---
  verify-seam:
    needs: [build, sast-attest]   # add other <gate>-attest jobs here
    permissions:
      contents: read
      attestations: read
      packages: read
    uses: attested-delivery/.github/.github/workflows/reusable-verify-gates.yml@<DOTGITHUB_SHA> # vX.Y.Z
    with:
      subject-ref: oci://ghcr.io/attested-delivery/<your-repo>@${{ needs.build.outputs.image-digest }}
      owner: attested-delivery
      signer-workflow: attested-delivery/.github/.github/workflows/reusable-attest-scan.yml
      predicate-types: |-
        https://attested-delivery.github.io/attestations/sast/v1
        https://attested-delivery.github.io/attestations/sca/v1

  # --- Fail-closed verify: OpenVEX (self-signed — separate call) ---
  # verify-vex:
  #   uses: attested-delivery/.github/.github/workflows/reusable-verify-gates.yml@<DOTGITHUB_SHA>
  #   with:
  #     signer-workflow: attested-delivery/.github/.github/workflows/reusable-vex.yml
  #     predicate-types: https://openvex.dev/ns/v0.2.0
  #     ...

  # --- Deploy job: only runs after all verify jobs pass ---
  deploy:
    needs: [verify-seam]   # add verify-vex etc. here
    # ...
```

**One signer per `verify-gates` call.** Seam-signed gates (SAST, SCA, IaC, container, posture, DAST) share `reusable-attest-scan.yml` as their signer. OpenVEX and k6 self-sign with their own workflow; each requires its own `verify-gates` invocation. Mixing predicates from different signers causes verification to fail on a valid artifact.

### If your build produces binaries or bundles

For static artifact releases (no container image), use `actions/attest-build-provenance` per build leg and `anchore/sbom-action` + `actions/attest-sbom` for the SBOM. Wire a fail-closed verify job before the release job using `gh attestation verify <artifact> --repo $GITHUB_REPOSITORY`. See [Caller Recipe D in the integration recipes reference](https://github.com/attested-delivery/.github/blob/main/.github/skills/attested-delivery/references/integration-recipes.md) for the proven full release shape.

## 4. Sign the container image (if applicable)

After the gate-attestation jobs, wire `sign-and-attest.yml` to produce the SLSA provenance, keyless cosign signature, CycloneDX SBOM, and vulnerability report as OCI referrers:

```yaml
  sign:
    needs: [build, verify-seam]
    permissions:
      id-token: write
      attestations: write
      packages: write
      contents: read
    uses: attested-delivery/.github/.github/workflows/sign-and-attest.yml@<DOTGITHUB_SHA> # vX.Y.Z
    with:
      image-name: ghcr.io/attested-delivery/<your-repo>
      image-digest: ${{ needs.build.outputs.image-digest }}
```

For the exact input contract, see [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/).

## 5. Add pin-check as a required status check

Once the `pin-check` job is green, add it to the branch protection ruleset as a required status check. This enforces SHA-pinning on every future PR and push.

Emit the following for the repo owner to apply:

```sh
# In the repo's branch protection settings (UI or gh CLI):
# Required status checks → add: "pin-check / pin-check"
```

Also add `dependabot.yml` for the `github-actions` ecosystem so SHA pins stay current without manual updates:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## 6. Add the remaining branch protection requirements

Emit the following for the repo owner to configure:

- Required reviewers (CODEOWNERS file)
- Dismiss stale reviews on push
- Require signed commits
- Require linear history; block force-push to the default branch
- Required status checks: include each in-scope gate + `pin-check`

See the [interface contracts](/docs/specifications/interface-contracts/) spec and the `RUNBOOK.md` in `attested-delivery/.github` for the full onboarding checklist.

## 7. Publish a SECURITY.md with verification instructions

Consumers of your repo need to know how to verify releases independently. Add a `SECURITY.md` with the verification commands from [How to Verify a Release](/docs/guides/verify-a-release).

## Verification

Run a dry-run dispatch of the workflow (tag-gate the publish job with `if: startsWith(github.ref, 'refs/tags/')` and add `workflow_dispatch` to enable dry runs). Then from a workstation:

```sh
# Confirm the seam-signed gate attestation exists and verifies
gh attestation verify "oci://ghcr.io/attested-delivery/<your-repo>@<digest>" \
  --owner attested-delivery \
  --signer-workflow attested-delivery/.github/.github/workflows/reusable-attest-scan.yml \
  --predicate-type https://attested-delivery.github.io/attestations/sast/v1
```

Expected output: `✓ Verification succeeded!`. If the workflow ran but no attestation exists, the seam job likely failed silently — check the Actions run for the `sast-attest` job.

## Troubleshooting

**Workflow fails at startup with a generic error (no step output).** The most common cause is a third-party action that is not on the org allow-list. Compare the actions used by the gate reusable against the allow-list in `attested-delivery/.github/README.md`. Ask the org owner to add the missing action before re-running.

**`verify-gates` fails with "no attestations found".** The seam job (`<gate>-attest`) did not complete successfully, or the subject digest in the verify call does not match the digest used during attestation. Confirm that `needs.build.outputs.image-digest` is identical in both the `<gate>-attest` and `verify-seam` jobs.

**`verify-gates` fails with a signer mismatch.** You may be mixing predicates from different signers in a single `verify-gates` call. OpenVEX and k6 are signed by their own workflows, not by `reusable-attest-scan.yml`. Use a separate `verify-gates` invocation for each signer group.

**`pin-check` fails.** One or more `uses:` references in your workflow files use a tag or branch ref instead of a 40-character SHA. Resolve the SHA with `gh api repos/<owner>/<action>/commits/<tag> --jq .sha` and update the reference.

## Related

- [Reference: Quality-Gate Workflows](/docs/reference/quality-gate-workflows/)
- [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/)
- [Concept: The Digest Is the Release](/docs/concepts/01-the-digest-is-the-release)
- [Concept: Enforce at Admission, Not by Convention](/docs/concepts/04-enforce-at-admission-not-by-convention)
- [Concept: SLSA L3 Is Nearly Free](/docs/concepts/05-slsa-l3-is-nearly-free)
- [How to Verify a Release](/docs/guides/verify-a-release)
- [How to Promote a Build](/docs/guides/promote-a-build)
