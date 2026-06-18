---
title: "ADR 0056: Attestation-Preserving Digest Promotion"
description: "Establishes sha256 digest as the canonical promotion key and mandates referrer-aware copy to preserve SLSA provenance, SBOM, and signature attestations across registry boundaries."
---

# ADR 0056: Attestation-Preserving Digest Promotion

Status: Accepted
Date: 2026-06-01

## Context

This design establishes the sha256 digest as the canonical promotion key — promotion-by-tag is never used because tags are mutable. The default tooling for OCI image copy (`crane cp`) copies only the image manifest and layers. Cosign signatures, SLSA provenance attestations, and SBOMs stored as OCI referrers in the source registry are **not copied** and do not appear in the destination registry after promotion (f_artifact_attestation_promotion_3, f_tooling_landscape_build_vs_buy_10).

ECR supports the OCI 1.1 Referrers API (GA June 2024) and replicates referrers on cross-region copy — but only if the source copy operation populates the referrers store, which `crane cp` does not do (f_artifact_attestation_promotion_12). The consequence is that the attestation chain breaks at the GHCR→ECR registry boundary: every environment from INT onward runs on a digest whose provenance cannot be verified.

A post-promotion gate using `crane digest` verifies **integrity** — that the manifest arrived unmodified — but not **provenance** — that the attached SLSA/SBOM/signature referrers are present and valid. A downstream `cosign verify-attestation` call fails silently in ECR because there are no referrers to verify (f_artifact_attestation_promotion_2). A production AWS platform examined during this research hit exactly this failure with `crane cp`: promotion succeeded integrity-check but attestation referrers were silently orphaned at the GHCR→ECR boundary.

This gap is P0: it renders the "attested artifact promotion" invariant unenforceable at runtime, violates NIST SSDF SP 800-218 practice PW.4.1 (protect software from tampering), and would fail a SLSA v1.1 verifier check at any environment past the source registry.

## Decision

Replace `crane cp` as the sole promotion mechanism with an **attestation-preserving promotion strategy**. Adopt the following in preference order:

1. **Primary (lowest friction on AWS): ECR managed signing + referrer-aware replication.** Enable AWS Signer signing profiles on ECR; promote with `crane cp` for the manifest, then have ECR's native referrer replication carry signatures and attestations on cross-region copy. No client key material; HSM-backed keys; OCI 1.1 referrers replicated automatically (f_tooling_landscape_build_vs_buy_2, f_tooling_landscape_build_vs_buy_4).

2. **Alternative A: `cosign copy --only=sig,att,sbom`.** An explicit post-`crane cp` step that copies cosign-managed referrers (signatures, attestations, SBOMs) to the ECR destination (f_artifact_attestation_promotion_4). Keeps `crane cp` as the layer-copy primitive; adds a second call per promotion workflow.

3. **Alternative B: `oras cp -r`.** Replace `crane cp` with `oras cp --recursive`, which copies the manifest, layers, and all linked referrers in a single call (f_tooling_landscape_build_vs_buy_10).

**Change the post-promotion verification gate** from `crane digest` (integrity only) to `cosign verify-attestation --type slsa` (provenance present + valid). This is the only gate that confirms the full attestation graph traveled with the digest.

The digest-as-canonical-identity invariant is the foundation of this design; this decision specifies the tooling that executes the copy and the gate that verifies success.

## Implementation Details

- Update the promotion workflows (INT, CERT, PROD) to use the chosen primary strategy.
- Add `cosign verify-attestation --type slsa --certificate-oidc-issuer https://token.actions.githubusercontent.com` as the mandatory final step of every promote workflow.
- Enable ECR tag immutability on all promotion target repositories (prerequisite for managed signing).
- Document the `crane digest` → `cosign verify-attestation` gate change in the promotion runbook.
- The issue-driven promotion YAML payload (ADR 0061) is unchanged; the attestation gate result is logged as a promotion issue comment.

## Alternatives Considered

- **Keep `crane cp` with no changes.** Rejected: the post-promote gate succeeds but attestation graph is orphaned; silent provenance break at every env past GHCR.
- **Rebuild the image at each environment.** Rejected: violates supply-chain integrity and defeats the audit purpose of digest-as-identity — the promoted digest must be byte-identical across environments.
- **Store attestations out-of-band (separate S3 bucket).** Rejected: OCI referrers are the standard store; out-of-band storage breaks toolchain compatibility (cosign, Kyverno, Ratify) and SLSA v1.1 verification expectations.

## Consequences

### Positive

- Attestation graph (SLSA provenance, SBOM, signature) survives promotion end-to-end; `cosign verify-attestation` succeeds at ECR for INT/CERT/PROD.
- Post-promote gate verifies provenance, not just integrity — closes the open loop identified in gap #1.
- NIST SSDF PW.4.1 and SLSA v1.1 verifier requirements satisfied at all environments.
- ECR managed signing removes client key material from promotion workflows.

### Risks / Negative

- ECR managed signing changes the signing identity; existing `cosign verify` callers using GHCR's Sigstore/Fulcio cert chain must update their verification policy.
- OCI 1.1 referrer fallback tag schema has active bugs in older cosign versions; pin cosign ≥ v2.6.0 and initialize TUF (f_tooling_landscape_build_vs_buy_15).
- `cosign copy` adds ~10–30 s per promote step depending on attestation payload size.

## Relationships

- **Relied on by:** ADR 0058 (SBOM via OCI referrers requires referrers to travel on promotion), ADR 0059 (admission-time verification requires referrers present in ECR), ADR 0062 (branching policy — the release candidate is the attested digest, not a branch).
- **Related:** ADR 0061 (DORA — deployment event anchored to a verified prod digest promotion).

## Well-Architected Alignment

Operational Excellence, Security
