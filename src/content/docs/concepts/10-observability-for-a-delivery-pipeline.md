---
title: "Observability for a Delivery Pipeline, Not Just the App"
description: "A signal catalog for the pipeline itself: what each signal is, which stage emits it, who consumes it, and what to alert on. Built on OpenTelemetry cicd semconv where it exists, honest where it does not."
diataxis_type: explanation
---

You can see every span your application emits in production and still be blind to your delivery pipeline. When a deploy stalls, when an attestation fails to verify, when a restore drill quietly stops running, there is often no signal at all — because nobody instrumented the pipeline the way they instrumented the app. The pipeline is software too. It deserves a signal catalog.

A signal catalog answers four questions for every signal worth emitting: what is it, which stage produces it, who consumes it, and what — if anything — pages someone. Writing that down forces a useful discipline. You discover the signals you assumed existed but do not, and you stop alerting on things no human acts on.

## Lean on a standard where one exists, and be honest where it does not

Most pipeline signals are application-defined: you emit them, no spec standardizes them. That is fine, as long as you do not dress them up as standards. There is exactly one standardized slice here, and it is worth using.

The OpenTelemetry CI/CD semantic conventions define a `cicd.*` namespace. `cicd.pipeline.run.duration` is "Duration of a pipeline run grouped by pipeline, state and result," `cicd.pipeline.run.errors` counts "the number of errors encountered in pipeline runs," and span attributes carry the outcome: `cicd.pipeline.name`, `cicd.pipeline.result`, `cicd.pipeline.task.run.result` ([OpenTelemetry CI/CD metrics](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/), [spans](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-spans/)). Two honesty caveats: the conventions are at Development status, not yet stable, so expect churn. And there is no OTel `deployment.*` metric — your DORA keys derive from the `cicd.*` pipeline signals plus deployment metadata you attach yourself.

Everything else in the catalog is application-defined but grounded in the tool or standard that motivates it. Where no industry SLO exists, the catalog says so rather than inventing a threshold. "Set per service" is a real answer; a fabricated number is not.

## The catalog

Each row maps a signal to the stage that emits it, the consumer who reads it, and the alert (if any). Stages are the human-readable phases of the pipeline: build, SBOM generation, vulnerability scan, provenance and signing, promotion, admission, rollout, recovery, and the steady-state maintenance loop.

| Signal | Stage | Consumer | Alert / SLO | Grounded in |
| --- | --- | --- | --- | --- |
| `cicd.pipeline.run.duration` | build | dashboard | alert on sustained regression vs baseline; no standard SLO | [OTel CI/CD](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/) |
| `image_digest` (`sha256:`) | build | audit | none — it is identity, not a measurement | [OCI dist-spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) |
| `sbom_generated_event` (CycloneDX 1.7, attached as referrer) | SBOM generation | audit / log | alert if SBOM missing for a built digest | [Syft](https://github.com/anchore/syft) |
| `vuln_scan_result` (+ attestation) | vulnerability scan | dashboard / gate | block on findings above the severity gate (gate is a policy choice) | [Grype](https://github.com/anchore/grype) |
| `slsa_provenance_attested` | provenance and signing | admission input / audit | alert if provenance missing for a promotable digest | [SLSA levels](https://slsa.dev/spec/v1.1/levels) |
| `test_result_attested` (in-toto predicate) | provenance and signing | admission input / audit | alert if attestation absent for a promotable digest | [in-toto test-result](https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md) |
| `keyless_sign_event` (Fulcio cert, Rekor v2 entry, cosign ≥ 2.6.0) | provenance and signing | admission input / audit | alert on signing failure for a promotable digest | [cosign signing](https://docs.sigstore.dev/cosign/signing/overview/) |
| `attestation_verification_result` (fail-closed verify) | promotion | gate / audit | block on verify failure or orphaned referrers | [cosign verify](https://docs.sigstore.dev/cosign/verifying/attestation/) |
| `argocd_sync_status` / `argocd_health_status` | rollout | dashboard / DORA | alert on `OutOfSync` for prod or `Degraded` health | [Argo CD](https://argo-cd.readthedocs.io/en/stable/) |
| `admission_verification_result` (deny on missing/invalid attestations) | admission | gate / audit | block on admission deny | [Kyverno](https://kyverno.io/docs/policy-types/image-validating-policy/) |
| `rollout_abort_event` (runtime fallback to prior stable) | rollout | alert / human | alert on abort — it is an incident signal | [Argo Rollouts](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/) |
| `gitops_revert_event` (durable revert to prior verified digest) | recovery | DORA (recovery time) / audit | none — recovery action; time tracked in DORA | [Argo CD](https://argo-cd.readthedocs.io/en/stable/) |
| `restore_drill_execution` | maintenance | audit / dashboard | alert if drill overdue or last drill failed (cadence is local policy) | [SOC 2 trust criteria](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022) |
| `sbom_rescan_result` (SBOM-first rescan as vuln DB updates) | maintenance | dashboard / alert | alert when rescan surfaces findings above the severity gate | [Grype](https://github.com/anchore/grype) |
| `supply_chain_tool_version` / `tool_drift` | maintenance | dashboard / alert | alert on tool below minimum, a non-SHA-pinned action, or a Rekor shard rotation needing re-anchor | [GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23) |

That is not exhaustive, but it covers the shape. Notice how few rows carry a numeric SLO. Most of these are pass/fail gates or hygiene signals where "passing" is the only target, and the few rate metrics genuinely have no industry-standard threshold.

## Three signals worth singling out

Most of the catalog is mechanical. Three signals repay extra attention because they catch failures the rest of your observability will not.

**Gate duration.** End-to-end pipeline timing rides on `cicd.pipeline.run.duration`, but that lumps together build, review, and approval. Add a per-gate duration metric of your own — `gate_duration_seconds` tagged with the gate name and the digest — and you can decompose lead time across the gates and point at the slow one. The validation that it is wired correctly: the per-gate durations plus the pipeline run duration should reconcile against the commit-to-healthy-deploy lead time for the same digest. Without it, "lead time is high" is a number you cannot act on.

**Attestation-verification result.** This is the signal that most teams skip and most regret. When you promote an image between registries, the attestations attached to it are separate OCI referrer manifests, not image layers — and a naive copy by digest leaves them behind. The fail-closed verify at the next boundary then correctly rejects an image whose provenance has vanished. If you do not emit and alert on the verification result, the first you hear of an orphaned-referrer problem is a production admission denial during a deploy. Emit it at every promotion boundary, and alert on both verify failure and orphaned referrers, so you catch the gap at promotion rather than at the production gate.

**Restore-drill execution.** Recovery capability decays silently. A backup job that has been failing for three weeks looks identical to one that never runs, until the day you need it. Emit a signal each time the restore drill executes and records a result, and alert when the drill is overdue or the last run failed. The cadence is a local policy choice — there is no standard frequency to quote — but the alert on "overdue or failed" is what turns an untested disaster-recovery plan into a tested one. This is also the signal an auditor asks for, because it is the evidence that recovery was exercised rather than merely documented.

## What to alert on, and what not to

The catalog's most useful column is the alert column, because it forces the question: would a human act on this page? Build duration regressing against baseline, yes. An SBOM missing for a built digest, yes. A signing failure, an admission deny, a rollout abort, a restore drill that went overdue — all yes, because each represents a broken invariant someone has to fix.

The DORA rate metrics, by contrast, are trend signals, not pages. So are branch age and the presence of an AI-provenance trailer. Paging on a slow-moving ratio trains people to ignore the pager. Put those on a dashboard, review them on a cadence, and reserve the alert for the gates and invariants that have actually broken. An observability layer for your pipeline is only worth building if the alerts it produces are ones people act on — everything else is a dashboard, and that is fine. The point is to know which is which before you wire the page.
