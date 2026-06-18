---
title: "ADR 0002: Declare SLSA Build Level 3 via Isolated Reusable Signing Workflow"
description: "Declares SLSA Build Level 3 by isolating the build-and-sign step into a reusable GitHub Actions workflow with an ephemeral Sigstore Fulcio identity."
---

# ADR 0002: Declare SLSA Build Level 3 via Isolated Reusable Signing Workflow

Status: Accepted
Date: 2026-06-01

## Context

Mandating "SLSA provenance" for every image build without specifying which SLSA Build Level is targeted leaves an exploitable gap: the default `actions/attest-build-provenance` produces SLSA Build **Level 2**, which allows a compromised build step to falsify its own provenance (f_supply_chain_security_sbom_1, f_artifact_attestation_promotion_7, f_tooling_landscape_build_vs_buy_3).

SLSA v1.1 defines Build L3 requirements beyond L2 in two areas (f_supply_chain_security_sbom_8):

1. **Provenance must be generated in a separately-hosted reusable workflow** that the build job cannot influence — preventing a compromised build step from falsifying its own provenance.
2. **Signing keys must be isolated** — they must not be accessible to the build job itself.

GitHub OIDC ephemeral credentials (short-lived Fulcio certificates, no stored private keys) **already satisfy the L3 key-isolation requirement** (f_supply_chain_security_sbom_15). The only remaining gap is requirement 1: the provenance generation must move to an isolated reusable workflow invoked as a separate job (f_artifact_attestation_promotion_13, f_supply_chain_security_sbom_8).

The `slsa-framework/slsa-github-generator` (maintained by Google) provides an L3-compliant isolated signing workflow callable as a reusable workflow from `actions/workflows/generator_container_slsa3.yml@refs/tags/v2.x`. This is the minimal-cost path to L3 and is compatible with the existing cosign/Sigstore stack.

Declaring L3 satisfies EO 14028 attestation expectations, NIST SSDF PS.1.1 (digitally sign software to verify integrity), and positions the SDLC to meet EU CRA supply-chain attestation requirements landing September 2026.

## Decision

Declare **SLSA Build Level 3** as the target and minimum acceptable level for all container image builds.

Achieve L3 by:

1. Extracting the provenance-generation step from the main build job into an **isolated reusable signing workflow** — either `slsa-framework/slsa-github-generator` or an internally hosted equivalent that follows the L3 isolation contract.
2. The signing workflow runs as a separate GitHub Actions job with `id-token: write` permission and no access to build artifacts except the image digest.
3. The resulting SLSA provenance predicate (`predicateType: https://slsa.dev/provenance/v1`) is attached to the image digest as an OCI referrer via `cosign attest`.
4. GitHub OIDC ephemeral credentials (Fulcio CA + Rekor transparency log) satisfy L3 key isolation without change.

SLSA L3 provenance is a build-time deliverable; ADR 0003 governs SBOM attachment; ADR 0004 governs admission-time verification that L3 provenance is present.

## Implementation Details

- Add a new reusable workflow `/.github/workflows/slsa-sign.yml` (internal) or reference `slsa-github-generator@v2.x` as a called workflow.
- The main build job outputs `image-digest` to the signing job via GitHub Actions job outputs; the signing job receives no build environment variables.
- Build workflow must declare `permissions: id-token: write` only in the signing job, not the build job.
- Update CCAB issue template to record SLSA L3 as the expected provenance level.
- Verify with `slsa-verifier verify-image <image>@<digest> --source-uri github.com/attested-delivery/<repo>`.

## Alternatives Considered

- **Remain at SLSA L2 (`actions/attest-build-provenance` default).** Rejected: L3 is achievable at low cost because GitHub OIDC ephemeral credentials already satisfy key isolation; L2 leaves provenance falsification risk from a compromised build job; EO 14028 expectations and EU CRA trajectory favor L3 declaration.
- **SLSA L4 (hermetic builds).** Not adopted: requires fully hermetic build environments (network isolation, reproducible builds) — disproportionate cost for the current substrate.
- **Commercial signing service (JFrog, Chainguard).** Not adopted at this stage; the OSS stack (cosign + Fulcio + Rekor) meets L3; commercial justified above ~200 images (see ADR 0008 for tooling policy).

## Consequences

### Positive

- Provenance cannot be self-attested by a compromised build step; falsification requires compromising the isolated signing workflow.
- `slsa-verifier` can independently confirm L3 compliance without trusting the build pipeline.
- EO 14028, NIST SSDF PS.1.1, and emerging EU CRA supply-chain clauses satisfied.
- Rekor v2 GA (Oct 2025) records DSSE entries append-only; the transparency log anchors L3 provenance claims (f_git_creep_ai_provenance_9).

### Risks / Negative

- Rekor v2 introduces annual shard rotation; hardcoded Rekor endpoint URLs break unless cosign ≥ v2.6.0 with TUF root initialization is pinned (f_tooling_landscape_build_vs_buy_15).
- Isolated signing workflow adds ~1–2 minutes to the build job wall-clock via job-chaining overhead.
- Internal teams must update any local `slsa-verifier` or `cosign verify-attestation` scripts that reference a specific Rekor instance URL.

## Relationships

- **Depends on:** ADR 0001 (attestation-preserving promotion — ensures L3 provenance travels to ECR).
- **Depended on by:** ADR 0003 (SBOM format selection cites SLSA L3 context), ADR 0004 (admission policy verifies L3 predicate), ADR 0005 (AI provenance injected into SLSA `externalParameters` before signing).
- **Related:** ADR 0008 (security tooling pinned by digest — signing workflow itself pinned to avoid supply-chain attack).

## Well-Architected Alignment

Security, Operational Excellence
