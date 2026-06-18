---
title: "ADR 0008: Syft + Grype as Security Toolchain; Pin All Security Tooling by Digest"
description: "Pins Syft and Grype by digest rather than tag to prevent supply-chain compromise via mutable security tooling tags."
---

Status: Accepted
Date: 2026-06-01

## Context

In March 2026, `aquasecurity/trivy-action` suffered a confirmed supply-chain compromise (CVE-2026-33634, CRITICAL). Attackers poisoned 76 of 77 mutable release tags and the corresponding release binaries to exfiltrate cloud credentials from CI runners. Any workflow referencing `uses: aquasecurity/trivy-action@<mutable-tag>` was silently executing attacker-controlled code with access to `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `AWS_*` environment variables, and any secrets mounted in the build environment (f_tooling_landscape_build_vs_buy_2).

The incident demonstrates a general failure mode: **mutable-tag references to security tooling are unacceptable in a supply-chain-hardened SDLC.** A tag (`v1`, `@master`, `@latest`) is a pointer that can be moved without warning. A digest (`@sha256:abc123…`) is an immutable content address. Using a mutable tag to reference the tooling that *verifies* supply-chain integrity undermines the very property it is meant to enforce.

Two additional factors drive the tooling selection:

1. **Trivy's compromise disqualifies it.** Beyond the immediate CVE, the incident revealed that `trivy-action`'s release process did not enforce immutable artifact references in its own CI — a structural hygiene gap inconsistent with SLSA L3 expectations (f_tooling_landscape_build_vs_buy_2).
2. **Syft + Grype are the natural counterparts for this design.** Syft generates CycloneDX 1.6 and SPDX 2.3 natively (ADR 0003's chosen formats). Grype consumes Syft SBOMs directly and supports VEX-aware triage aligned with CycloneDX 1.6 VEX fields. Both are maintained by Anchore under a permissive Apache-2.0 license, with active SLSA provenance published for their own releases (f_tooling_landscape_build_vs_buy_2, f_tooling_landscape_build_vs_buy_4).

## Decision

1. **Standardize on Syft (SBOM generation) and Grype (vulnerability scanning)** as the security toolchain for all container image and Helm chart builds. Trivy and `aquasecurity/trivy-action` are not used in new or existing workflows.

2. **Pin ALL security tooling references by digest — never by mutable tag.** This applies to:
   - GitHub Actions `uses:` references: `uses: anchore/scan-action@<sha256-digest>` not `@v3`.
   - `slsa-framework/slsa-github-generator` and any other reusable workflow (ADR 0002).
   - Kyverno Helm chart (ADR 0004).
   - cosign, oras, crane binaries installed in build steps — installed from a digest-pinned release asset, not `latest`.

3. **Establish a digest-pin refresh cadence:** pin digests are updated monthly (or immediately on a published CVE for the pinned version) via a dedicated `chore/update-digest-pins` PR. The PR must pass the full CI gate and receive CODEOWNERS approval before merge.

4. **Verify pinned tooling provenance:** for any security tool that publishes SLSA provenance for its own releases (Syft, Grype, cosign, slsa-github-generator), confirm the provenance before updating the pin — `slsa-verifier verify-artifact <binary> --provenance-path <provenance.json> --source-uri github.com/anchore/syft`.

## Implementation Details

- Replace `aquasecurity/trivy-action` with `anchore/scan-action@<digest>` and `anchore/sbom-action@<digest>` in all build workflows.
- Record pinned digests in a project-level `.github/digest-pins.yml` manifest; the refresh PR updates this file and all workflow `uses:` references atomically.
- Add a repository ruleset check: any `uses:` reference in a workflow file that does not contain `@sha256:` is flagged as a required-fix CI failure.
- Syft and Grype versions for local developer tooling are declared in `devcontainer.json` (or equivalent) using the same digests as CI to eliminate environment drift.
- Grype is configured with a `.grype.yaml` specifying `ignore` rules for VEX-annotated non-exploitable CVEs; the ignore list is reviewed at each digest-pin refresh.

## Alternatives Considered

- **Trivy + `aquasecurity/trivy-action`.** Rejected: CVE-2026-33634 supply-chain compromise (f_tooling_landscape_build_vs_buy_2); structural release-hygiene gaps inconsistent with SLSA L3 posture.
- **Pin Trivy by digest (continue using Trivy, just pin it).** Rejected: the compromise involved poisoned release *binaries* as well as tags — even a digest-pinned `trivy-action` at the time of compromise would have referenced a poisoned binary. The tooling supplier's own security posture is a selection criterion.
- **Commercial scanning service (Snyk, JFrog Xray, Chainguard).** Not adopted at this stage: the OSS Syft + Grype stack meets SBOM generation and vulnerability scanning requirements; commercial justified above ~200 images or when cross-language SBOM federation is required. Reassess at scale.
- **Mutable-tag pinning with Dependabot auto-updates.** Rejected: Dependabot updates by tag, not digest; the window between a tag being poisoned and Dependabot detecting a version bump is unbounded. Digest pinning eliminates the attack surface; Dependabot can still open PRs if configured to update digests.

## Consequences

### Positive

- Eliminates the mutable-tag attack surface for all security tooling; any supply-chain compromise of a pinned tool is detectable as a digest mismatch.
- Syft's native CycloneDX 1.6 + SPDX 2.3 output aligns with ADR 0003 format decisions without a conversion step.
- Grype's direct SBOM consumption enables VEX-aware triage; false-positive noise is reduced without manual triage overhead.
- Digest-pin manifest provides an auditable record of the exact tooling versions used in every build.

### Risks / Negative

- Monthly digest-pin refresh is an operational discipline; missed updates leave the toolchain on older (potentially vulnerable) versions. Automate reminder via GitHub scheduled workflow.
- Developer local environments must stay in sync with CI digests; `devcontainer.json` is the canonical sync point, but developers who do not use devcontainers require a separate update path.
- Grype vulnerability database is fetched at scan time; air-gapped environments require a pre-fetched DB mirror — document in the offline-operations runbook.

## Relationships

- **Supports:** ADR 0003 (Syft as the SBOM generator — CycloneDX 1.6 output), ADR 0001 (attestation-preserving promotion — Grype re-attestation schedule for promoted digests).
- **Referenced by:** ADR 0002 (tooling-pin policy cited for the `slsa-github-generator` reusable workflow pin), ADR 0004 (Kyverno Helm chart pinned by digest per this policy).
- **Related:** ADR 0007 (GitHub Flow — hotfix branches must also pass the Grype gate before merge to `main`).

## Well-Architected Alignment

Security, Operational Excellence
