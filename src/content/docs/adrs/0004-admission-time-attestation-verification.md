---
title: "ADR 0004: Admission-Time Attestation Verification via Kyverno ImageValidatingPolicy"
description: "Enforces a deny-by-default Kubernetes admission webhook that rejects any workload whose image lacks a valid signature and required SLSA provenance and SBOM attestations."
---

# ADR 0004: Admission-Time Attestation Verification via Kyverno ImageValidatingPolicy

Status: Accepted
Date: 2026-06-01

## Context

A supply-chain SDLC that aspires to "SBOM/SLSA/cosign published and verified" as a PROD gate condition has an open loop if the "verified" half has no enforcement mechanism at deploy time: the build pipeline produces and attaches attestations, but nothing at the Kubernetes layer confirms they are present and valid before a container starts (f_validation_evidence_attestation_1).

OPA Gatekeeper is commonly deployed for Kubernetes restricted Pod Security Standards — enforcing structural workload policy (pod security, resource limits, label requirements). It is **not** wired to attestation verification: a pod referencing an unsigned image or a digest with no SLSA provenance is not rejected at admission (f_policy_compliance_gates_4, f_validation_evidence_attestation_1). A production AWS platform examined during this research had OPA Gatekeeper installed and enforcing pod security standards but with no attestation rules — the attestation loop was designed but left open.

All three admission-enforcement engines can close this gap (f_policy_compliance_gates_1, f_policy_compliance_gates_2, f_policy_compliance_gates_3):

- **Kyverno `ImageValidatingPolicy`** (Kyverno ≥ 1.13): native `verifyImages` block supporting cosign keyless, GitHub Artifact Attestations, OCI referrers, and CEL expression matching on attestation predicates. Ships as a Kyverno-native CRD with no external data provider required.
- **sigstore `policy-controller`**: a separate webhook that enforces `ClusterImagePolicy`; requires deploying a second admission webhook alongside any existing Gatekeeper installation.
- **OPA Gatekeeper + Ratify external data provider**: extends an existing Gatekeeper deployment; GitHub Artifact Attestation enforcement entered public preview June 2025 (f_validation_evidence_attestation_13).

Kyverno `ImageValidatingPolicy` is self-contained and handles the full image-validation surface in a single controller without requiring Ratify or a second webhook. When OPA Gatekeeper is used exclusively for pod security policy with no existing attestation rules, adopting Kyverno for image validation preserves clean separation of concerns: Gatekeeper owns structural workload policy; Kyverno owns image attestation policy.

## Decision

Deploy **Kyverno** and configure `ImageValidatingPolicy` resources to enforce attestation verification at pod admission across all environments.

Enforcement configuration:

- `validationActions: [Deny]` — any pod whose image digest lacks a valid cosign signature or SLSA provenance attestation is **denied**, not audited.
- `failurePolicy: Fail` — if Kyverno is unavailable, admission is denied (fail-closed).
- Verify cosign **keyless** signature with: `issuer: https://token.actions.githubusercontent.com`, `subject` regex matching `https://github.com/attested-delivery/*/…/.github/workflows/build.yml@refs/heads/main`.
- Verify SLSA provenance predicate (`predicateType: https://slsa.dev/provenance/v1`) for L3 compliance per ADR 0002.

### Rollout sequence

1. **Audit mode** (`validationActions: [Audit]`): deploy policy across all environments; surface images violating the policy via Kyverno policy reports without blocking. Target: 1–2 weeks.
2. **Enforce on non-prod** (`validationActions: [Deny]` on INT/CERT): flush out tooling gaps and edge cases.
3. **Enforce on prod**: flip `validationActions: [Deny]` on the prod Kyverno instance. Coordinate with the prod Argo CD release cycle to avoid blocking in-flight deployments during the cutover.

This decision does not replace OPA Gatekeeper for pod security standards — it complements it. Gatekeeper handles structural policy; Kyverno handles image attestation policy.

## Implementation Details

- Deploy Kyverno via the official Helm chart pinned by digest (per ADR 0008 tooling-pin policy).
- Create `ClusterPolicy` of kind `ImageValidatingPolicy` with a `verifyImages` block per environment tier.
- Store Kyverno policy manifests under `k8s/kyverno/` in the GitOps repo, subject to the same PR + CODEOWNERS gates as other prod manifests.
- Export Kyverno policy report findings to Datadog/CloudWatch as a compliance metric.
- Update the admission runbook to describe the Kyverno Deny path and the break-glass procedure.
- Reference `cosign verify-attestation` in pre-deployment CI check to surface failures before Kubernetes admission (shift-left complement).

## Alternatives Considered

- **sigstore `policy-controller`.** Not adopted: requires a second admission webhook alongside Gatekeeper; adds operational overhead for a capability Kyverno covers natively. Valid alternative if the org standardizes on policy-controller for other policy needs.
- **OPA Gatekeeper + Ratify.** Not adopted at this time: Ratify GitHub Artifact Attestation enforcement is in public preview (June 2025); extending Gatekeeper with an external data provider adds operational complexity. Reassess when Ratify GA lands (f_validation_evidence_attestation_13).
- **No admission enforcement (rely on CI gate).** Rejected: CI gates prevent production of unattested images but cannot prevent deployment of an image that bypasses CI (e.g., a manually pushed digest, an emergency patch with skipped CI). Admission is the last line of defense.

## Consequences

### Positive

- Closes gap #2: no unattested digest can reach a running pod in any environment, regardless of how it entered the registry.
- Satisfies NIST SSDF RV.1.3 (confirm software integrity before deployment), SOC2 CC6.8 (unauthorized software prevention), ISO 27001:2022 A.8.19 (secure software installation).
- Audit→Enforce rollout sequence surfaces policy violations before they become prod blockers.
- Kyverno policy reports produce evidence records for SOC2 audits without additional tooling.

### Risks / Negative

- Fail-closed (`failurePolicy: Fail`) means a Kyverno outage blocks all pod scheduling; Kyverno HA deployment (3 replicas, PDB) is a hard prerequisite.
- Existing images in prod that predate the attestation pipeline will fail the policy on re-deploy; a migration inventory is required before enforcing on prod.
- `subject` regex pinned to `main` branch signature will reject hotfix images signed from `hotfix/*` branches unless the regex is updated; coordinate with ADR 0007.

## Relationships

- **Depends on:** ADR 0001 (attestation-preserving promotion — referrers must be present in ECR for Kyverno to verify), ADR 0002 (SLSA L3 provenance is the predicate Kyverno verifies), ADR 0008 (Kyverno Helm chart pinned by digest per tooling-pin policy).
- **Related:** ADR 0003 (SBOM referrer optional additional verification predicate), ADR 0007 (branching policy — Kyverno `subject` regex pinned to `main` must be updated for hotfix branches per that ADR's guidance).

## Well-Architected Alignment

Security, Operational Excellence
