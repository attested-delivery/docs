---
title: "ADR 0060: AI Provenance via git-creep Trailers Injected into SLSA externalParameters"
description: "Records AI authorship in git trailers using a dedicated Assisted-by field and propagates it into SLSA externalParameters for verifiable AI provenance."
---

# ADR 0060: AI Provenance via git-creep Trailers Injected into SLSA externalParameters

Status: Accepted
Date: 2026-06-01

## Context

As AI-assisted authoring becomes standard, the SDLC must record *how code was authored* — which AI tools participated, at what confidence level, and whether the interaction was cryptographically attestable — for three reasons:

1. **DORA 2025 shows AI degrades stability while improving throughput.** Faros telemetry (22k devs) shows +54% bugs/dev and +242.7% incidents/PR for AI-assisted commits (f_dora_metrics_9). Segmenting DORA metrics by AI authorship mode (ADR 0061) requires per-commit provenance data to exist.

2. **EU AI Act Article 12** mandates automatic logging for high-risk AI systems (binding August 2, 2026). Standard coding assistants are generally out of scope; where they are in scope, the SDLC must demonstrate a per-commit record schema (f_git_creep_ai_provenance_14).

3. **The ecosystem is fragmenting.** At least four incompatible AI-provenance specs exist (Agent Trace, Git AI, git-creep, Assisted-by trailer); 81% of enterprises have zero AI-usage visibility (f_git_creep_ai_provenance_13). The GPAI Code of Practice (July 2025) mandates provenance metadata for GPAI models; the Kernel community has converged on `Assisted-by:` as a lightweight variant (f_git_creep_ai_provenance_12). Waiting for standards convergence means accumulating an untracked debt.

**What git-creep provides:** An 18-key git-trailer schema (`AI-Tool`, `AI-Authoring-Mode`, `AI-Session-Id`, `AI-Attestation-Method`, `AI-Confidence`, and 13 others) injected via a permissive `prepare-commit-msg` hook that exits 0 on failure and never blocks commits (f_git_creep_ai_provenance_1, f_git_creep_ai_provenance_4). Two orthogonal provenance axes (f_git_creep_ai_provenance_3):

- **Analytics weight**: `AI-Authoring-Mode` enum carries a confidence weight (all three tool-attested modes = 1.00; `chatbot-paste-attested` = 0.50; `chatbot-paste-detected` = 0.25) for DORA cohort math.
- **Cryptographic**: only `autonomous-workflow` commits in Actions with `id-token: write` receive `AI-Attestation-Method: github-oidc`, backed by a short-lived Fulcio cert logged to Rekor.

**`Co-authored-by` is the wrong mechanism for AI provenance.** The VS Code Copilot incident (April–May 2026, reverted after community backlash) demonstrated that silently inserting `Co-authored-by: Copilot <…>` destroys trust and conflates authorship with tool use (f_git_creep_ai_provenance_11). `Co-authored-by` is a commit authorship claim; AI provenance is a process metadata claim. They belong in different trailer namespaces.

## Decision

Adopt **git-creep's 18-key AI-provenance trailer schema** as the project-wide standard for per-commit AI authorship metadata.

Implementation:

1. **Inject via a permissive `prepare-commit-msg` hook** installed as part of the developer setup script. The hook exits 0 on error; it never blocks a commit.
2. **Analytics axis**: the `AI-Authoring-Mode` value and associated confidence weight feed the DORA cohort segmentation defined in ADR 0061.
3. **Cryptographic axis**: in GitHub Actions workflows, inject `AI-Attestation-Method: github-oidc` and the OIDC-backed session reference for commits made by autonomous agents (`id-token: write` required).
4. **SLSA predicate injection**: extend the SLSA `externalParameters` block in the provenance predicate with vendor-namespaced AI fields (e.g., `ai.tool`, `ai.authoring_mode`, `ai.session_id`) per the SLSA v1.1 extension convention. This embeds AI provenance in the cryptographically signed SLSA record without modifying the predicate schema.
5. **`Co-authored-by` for AI provenance is explicitly rejected** across all workflows; repository rulesets should flag its presence in commit messages where an AI trailer is present.

The creep library operates in scope-limited parse-and-record mode; analytics, estimators, and DORA overlays are handled by ADR 0061 tooling, not creep itself (f_git_creep_ai_provenance_17).

## Implementation Details

- Install `prepare-commit-msg` hook via `creep install` in `Makefile` / `devcontainer.json` setup.
- Configure `.creep.toml` in the repo root specifying the 18-key schema; vendor sidecars (following a vendor-sidecar pattern) write vendor-specific fields into designated namespaced keys (f_git_creep_ai_provenance_6).
- Add `creep export otlp` to CI post-build step to emit one OTel log record per commit for DORA dashboard ingestion (f_git_creep_ai_provenance_7).
- Update `slsa-sign.yml` (ADR 0057) to append `externalParameters.ai.*` fields from the commit trailers before signing.
- Add a repo ruleset check: commits in `main` with `Co-authored-by: github-actions` or `Co-authored-by: Copilot` without a corresponding `AI-Authoring-Mode` trailer are flagged (advisory, not blocking, for 90 days).

## Alternatives Considered

- **`Co-authored-by: <AI tool>` (GitHub/VS Code Copilot pattern).** Explicitly rejected: conflates authorship with tool use; was reverted by the VS Code team after community backlash (f_git_creep_ai_provenance_11); destroys trust in commit authorship metadata.
- **`Assisted-by:` trailer (Linux Kernel / Fedora pattern).** A valid, minimal alternative. Rejected in favor of creep's full schema because `Assisted-by:` carries no weight, no session ID, no cryptographic axis — insufficient for DORA cohort segmentation and EU AI Act logging obligations.
- **Wait for ecosystem standard convergence.** Rejected: the ecosystem has been fragmenting for 18+ months (f_git_creep_ai_provenance_13); waiting accumulates untracked AI-authorship debt while DORA instability signals grow.
- **No per-commit tracking; aggregate survey metrics only (DORA 2025 approach).** Rejected: survey-level cohort archetypes cannot produce per-digest AI provenance for SLSA or admission-time inspection; too coarse for the audit and compliance requirements.

## Consequences

### Positive

- Per-commit AI-authorship metadata exists for DORA cohort segmentation (ADR 0061) and SLSA `externalParameters` enrichment.
- EU AI Act Art.12 minimum record schema satisfied where high-risk AI systems apply (f_git_creep_ai_provenance_14).
- GPAI Code of Practice provenance metadata obligation met (f_git_creep_ai_provenance_15).
- Permissive hook design: zero developer friction; no commit is blocked by missing AI metadata.
- Cryptographic axis (`github-oidc`) creates an unforgeable provenance record for autonomous-workflow commits.

### Risks / Negative

- Developer adoption of the hook requires setup script enforcement; trailers will be absent from commits made in environments without the hook installed until enforcement is added.
- `externalParameters.ai.*` field injection into the SLSA predicate requires coordination with ADR 0057's signing workflow to ensure the fields are populated before signing, not after.
- OTel `code.ai_provenance.*` attribute names are not yet upstream in the OpenTelemetry semantic conventions; the creep-proposed mapping may evolve (f_git_creep_ai_provenance_2).

## Relationships

- **Depends on:** ADR 0057 (SLSA provenance signing workflow — AI fields injected into `externalParameters` before signing).
- **Feeds into:** ADR 0061 (DORA instrumentation — `AI-Authoring-Mode` weight is the AI-cohort segmentation input).
- **Related:** ADR 0059 (admission-time verification operates on the SLSA predicate that embeds AI provenance fields).

## Well-Architected Alignment

Operational Excellence, Security
