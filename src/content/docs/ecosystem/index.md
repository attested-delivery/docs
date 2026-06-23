---
title: "Ecosystem Hub"
description: "A map of every repository in the attested-delivery org, what each one does, and where to find the documentation for it."
diataxis_type: explanation
diataxis_topic: "attested-delivery ecosystem map"
---

The `attested-delivery` org is a set of composable, independently useful repos that share one promise: the thing you verified is the thing that runs. Each repo is a separate concern — template, reusable workflow catalog, plugin marketplace, or docs — and they fit together through the same attestation model.

For the model itself, start with the [Overview](/docs/overview/) and the [Concepts](/docs/concepts/) series. This page is the map, not the explanation.

---

## Repositories

Each entry below links to that repo's own documentation. The repos own their specifics; we link, never duplicate.

### [`rust-template`](https://github.com/attested-delivery/rust-template)

Production-grade Rust crate template: multi-platform builds (5 targets), `just`-driven local CI parity, SLSA Build Level 3 provenance, CycloneDX SBOM, and crates.io trusted publishing. The `v0.1.0` release is publicly attested and is the artifact used in the [introductory tutorial](/docs/tutorials/verify-your-first-attested-release/).

[Repo documentation →](https://github.com/attested-delivery/rust-template/blob/main/docs/README.md)

---

### [`attested-iac-template`](https://github.com/attested-delivery/attested-iac-template)

Copier template for attested OpenTofu/Terraform modules and per-cloud examples. Wires Trivy and Checkov quality gates so IaC changes carry the same signed, digest-bound verdicts as application code.

[Repo documentation →](https://github.com/attested-delivery/attested-iac-template/blob/main/docs/README.md)

---

### [`attested-pipeline-template`](https://github.com/attested-delivery/attested-pipeline-template)

Language-agnostic Copier template for the attested release pipeline. Instantiates a thin caller repo that wires the central reusable workflows from `.github`, produces SLSA provenance and a CycloneDX SBOM on every release, and includes a fail-closed admission-verify job. The `v0.1.0` release is publicly attested.

[Repo documentation →](https://github.com/attested-delivery/attested-pipeline-template/blob/main/docs/README.md)

---

### [`claude-code-plugins`](https://github.com/attested-delivery/claude-code-plugins)

Attested Claude Code plugin marketplace. Plugins are admitted through a catalog gate: each accepted plugin carries a signed attestation of the review verdict so admission is fail-closed and the decision is independently verifiable.

[Repo documentation →](https://github.com/attested-delivery/claude-code-plugins/blob/main/docs/README.md)

---

## Learn the ecosystem

The in-site documentation is organized by the [Diátaxis](https://diataxis.fr/) framework. Pick the quadrant that matches what you need right now.

### Tutorial — Learning by doing

| Page | What you will do |
| --- | --- |
| [Verify Your First Attested Release](/docs/tutorials/verify-your-first-attested-release/) | Download a published artifact and verify its SLSA provenance and CycloneDX SBOM from a clean workstation |

### How-to guides — Task-oriented

| Page | Task |
| --- | --- |
| [Onboard a repo](/docs/guides/onboard-a-repo/) | Wire a repo to the central quality-gate reusables and attestation seam |
| [Verify a release](/docs/guides/verify-a-release/) | Verify a release artifact's provenance, SBOM, and gate attestations from the command line |
| [Promote a build](/docs/guides/promote-a-build/) | Copy a release artifact by digest between environments with attestations intact |

### Reference — Authoritative specification

| Page | What it covers |
| --- | --- |
| [Quality gate workflows](/docs/reference/quality-gate-workflows/) | SAST, SCA, container, IaC, posture, and DAST reusable workflow contracts |
| [Signing and verification workflows](/docs/reference/signing-and-verification-workflows/) | `reusable-attest-scan`, `sign-and-attest`, `verify-attestation`, and `reusable-verify-gates` contracts |
| [CI and pinning workflows](/docs/reference/ci-and-pinning-workflows/) | `pin-check`, `actionlint`, and dependency-review contracts |
| [Catalog updater](/docs/reference/catalog-updater/) | How the `.github` reusable catalog is versioned and how callers update their SHA pins |

### Explanation — Understanding

| Section | What it covers |
| --- | --- |
| [Concepts](/docs/concepts/) | The foundational ideas: digest identity, attestation referrers, SLSA L3, fail-closed admission, and supply-chain hazards |
| [Specifications](/docs/specifications/) | Formal contracts for quality gates, interface boundaries, and the promotion-attestation pipeline |
| [ADRs](/docs/adrs/) | Recorded architectural decisions — why we made the choices we made and what we ruled out |
