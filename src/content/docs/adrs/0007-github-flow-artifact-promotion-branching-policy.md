---
title: "ADR 0007: GitHub Flow with Artifact-Promotion Branching Policy"
description: "Adopts GitHub Flow with short-lived feature branches, immutable tags, and the attested digest as the unit of release, rejecting git-flow for this continuous-delivery profile."
---

Status: Accepted
Date: 2026-06-01

## Context

This SDLC delivers a continuously-deployed service in which the **release candidate and the release are both the attested image digest**, not a branch (see ADR 0001, ADR 0034-class digest-canonical promotion). The branching model therefore only needs to support: integrating change into a single mainline, isolating in-flight work, shipping an urgent fix, and — rarely — maintaining a previously-released version. It does **not** need to carry release-candidate state, because that state lives in the artifact and its attestations as it is promoted DEV→INT→CERT→gate→PROD.

Three branching models were evaluated against this profile: git-flow (`develop` + `release/*` + `hotfix/*` + `main`), GitHub Flow (single long-lived `main`, short-lived topic branches, deploy from `main`), and trunk-based development. The evidence steers decisively toward GitHub Flow:

- git-flow's own author has, since 2020, prominently advised teams that continuously deliver a single-version web service to use GitHub Flow or a simpler model rather than git-flow (f_gitflow_branching_model_4). Choosing git-flow for this profile means choosing a model its creator advises against for exactly this case.
- With digest promotion, a `release/*` branch adds merge and reconciliation overhead without adding a capability the artifact layer does not already provide; the stabilized RC is the attested digest progressing through environments (f_gitflow_branching_model_1, f_gitflow_branching_model_2).
- The governance properties teams associate with git-flow are obtained at other layers in this design: the release "tag-and-ceremony" maps to the change-gate record (ADR 0006 / governance), and blast-radius isolation maps to separate per-environment GitOps control planes — not to branch topology (f_gitflow_branching_model_3, f_gitflow_branching_model_5).

A production AWS platform examined during this research independently arrived at GitHub Flow in practice (no `develop`, `release/*`, or `hotfix/*` branches; feature branch → PR → merge to `main` → digest promoted through gates), corroborating that this profile lands on GitHub Flow when built for real (f_gitflow_branching_model_1).

## Decision

Adopt **GitHub Flow with an artifact-promotion overlay** as the branching policy:

1. **`main` is the only long-lived branch** and is always releasable. All work occurs on short-lived topic branches (`feature/*`, `fix/*`, `hotfix/*`, `chore/*`) cut from `main` and merged back via PR with required CODEOWNERS approval and green CI. Keep branch lifetimes short (hours–days) to stay close to trunk-based integration.
2. **The release candidate and the release are the attested digest, not a branch.** Stabilization happens by promoting the digest through INT→CERT→change-gate→PROD (ADR 0001). There is no `release/*` branch in the normal flow.
3. **A hotfix is a short-lived `hotfix/*` branch off `main`, shipped fix-forward.** It carries the *same* attestation requirements as any other change (SLSA provenance, SBOM, signature — ADR 0002/0003) and an expedited approval path (HOTFIX-RUNBOOK); the expedited path compresses *approvals*, not *provenance*. The fix lands on `main` and is promoted as a normal digest.
4. **Versioning:** tag the release commit on `main` with an annotated SemVer git tag, and apply an immutable, informational registry tag to the digest. The digest remains canonical; tags never drive promotion (ADR 0001 / digest-canonical invariant).
5. **`release/x.y` long-lived branches are a documented exception, not the norm** — used only when a previously-released version is genuinely supported in parallel (e.g., regulated back-version maintenance). When used, each maintained line still ships via digest promotion and attestation; the branch exists solely to host backports.

## Alternatives Considered

- **git-flow (`develop` + `release/*` + `hotfix/*`).** Rejected for the continuous-delivery profile: its author advises against it here (f_gitflow_branching_model_4); `release/*` duplicates state already held by the promoted digest; and its governance benefits are provided at the artifact, gate, and GitOps-topology layers instead. **Retained as the recommended model only for the parallel-supported-versions profile** (shrink-wrapped/on-prem software with several concurrently-maintained releases); a team in that profile should adopt git-flow `release/*` topology and accept its merge overhead as the cost of parallel maintenance.
- **Pure trunk-based development (no branches / branch-by-abstraction + feature flags).** A valid and slightly stronger-CI variant of this decision; adopted in spirit (short-lived branches, frequent integration). Full no-branch trunk-based is left optional per team maturity (feature-flag discipline, fast CI) rather than mandated.
- **Environment branches (`int`/`cert`/`prod` branches that you merge into to deploy).** Rejected: it reintroduces branch-as-release state, drifts environments via divergent merges, and conflicts with the digest-canonical invariant (the same digest, not a re-merged branch, must reach prod).

## Consequences

### Positive

- Minimal source-control ceremony; the system's weight sits in the artifact + attestations, where it belongs.
- No `develop`↔`release`↔`main` back-merge overhead; fewer merge conflicts and less release-branch drift.
- Aligns with the digest-canonical promotion model and with the examined production reality, so it is implementable as-is.
- Hotfix path is a normal short-lived branch — one mental model, fewer special cases — while preserving full attestation.

### Risks / Negative

- GitHub Flow assumes fast, reliable CI and disciplined small PRs; weak CI makes a single `main` riskier (mitigated by the local-first + multi-gate pipeline, ADR 0004 and validation loop).
- Teams migrating from git-flow must unlearn `release/*` stabilization and trust artifact promotion instead — a process change, not just a tooling change.
- The `release/x.y` exception needs a written trigger so it is not adopted by habit; this ADR is that trigger.

## Relationships

- **Enables / relies on:** digest-canonical, attestation-preserving promotion (ADR 0001) — the reason a release candidate need not be a branch.
- **Related:** ADR 0006 (DORA — "deployment" defined at the prod digest promotion, not a branch merge), ADR 0002/0003 (attestation requirements that a hotfix branch must still satisfy), HOTFIX-RUNBOOK (the fix-forward procedure).
- **Supersedes (conceptually):** the implicit "git-flow" framing of the original request — recorded here as the evaluated-and-rejected alternative for this profile.

## Well-Architected Alignment

Operational Excellence
