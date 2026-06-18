---
title: "Overview"
description: "What attested delivery is, the three pillars it is built on, and how the documentation sections fit together."
---

## What is attested delivery?

Attested delivery is an approach to software release in which every artifact — container image, binary, or package — is cryptographically tied to the exact bytes that were built and verified. An artifact is released only when three conditions hold simultaneously:

1. It is byte-identical to the artifact that passed validation (digest identity).
2. It carries re-verifiable attestations: a SLSA Build Level 3 provenance statement, a cosign signature, a CycloneDX SBOM, and a vulnerability scan result stored as OCI referrers.
3. Publication into every downstream environment is gated on a fail-closed admission check that verifies all of the above before any workload runs.

The system is built on GitHub Flow and GitHub Actions. There are no custom servers, no proprietary signing hardware, and no per-environment rebuilds. The release candidate is the attested digest, not a branch name.

## Three pillars

### 1. Digest identity

A container tag is a mutable pointer. `myservice:v1.4.2` can silently refer to different bytes tomorrow than it does today. The sha256 digest is immutable: the same bytes always produce the same digest, and different bytes always produce a different digest.

This organization treats the sha256 digest as the canonical identifier for every release. Tags are informational labels applied to a digest after the fact, and they are made immutable so they cannot silently move. Build once. Promote that exact digest through every environment. Never rebuild.

### 2. Provenance attestation

A signature produced at build time is a claim that the bytes existed at that point. It is not a guarantee that the thing you are running is the thing that was signed — unless the signature survives the journey from the build environment to the runtime environment.

Attestations are stored as OCI referrers attached to the image digest in the registry. Naive `crane cp` image promotion does not copy referrers. This organization uses referrer-aware promotion (ORAS or `crane cp --all-manifests`) so that the full attestation graph — SLSA provenance, SBOM, vulnerability report, cosign signature — travels with the digest to every registry and every environment.

### 3. Fail-closed admission

A Kubernetes validating admission webhook (Kyverno `ImageValidatingPolicy` or sigstore policy-controller) enforces a deny-by-default policy: any pod that references an image without a valid signature and the required SLSA and SBOM attestations is rejected. Enforcement happens at admission time, not at build time. There is no convention to follow or forget; the cluster simply does not run unattestad images.

## How the documentation is organized

**Concepts** — Ten articles explaining the design rationale behind each pillar. Start with [The Digest Is the Release](/concepts/01-the-digest-is-the-release/) if you are new to this approach.

**Specifications** — Formal specifications for the components you will implement: the promotion pipeline, interface contracts, production readiness gates, and GitHub-native quality gates.

**Architecture Decisions** — Eight ADRs that record the tradeoffs behind every significant technical choice. Each ADR is searchable, standalone, and records not just the decision but the alternatives that were considered and rejected.
