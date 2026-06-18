---
title: "ADR 0061: DORA Instrumentation — Deployment Definition and Five-Event Pipeline"
description: "Defines a deployment as a production digest promotion event and instruments all five DORA metrics with AI-cohort segmentation."
---

# ADR 0061: DORA Instrumentation — Deployment Definition and Five-Event Pipeline

Status: Accepted
Date: 2026-06-01

## Context

DORA metrics are the standard measure of software delivery performance, but they are only meaningful if the key terms are precisely defined. Without a canonical definition of "deployment," teams routinely double- or triple-count DEV/INT/CERT Argo CD syncs, overstating deployment frequency while understating lead time (f_dora_metrics_1).

**DORA 2025 update:** the four-key model (DF, LT, CFR, MTTR) evolves to five metrics by promoting "Failed Deployment Recovery Time" (FDRT, previously part of MTTR) to a standalone throughput metric alongside DF. "Deployment rework rate" emerges as the fifth metric — the ratio of deployments that are immediately rolled back or reverted (f_dora_metrics_13). AI is now positively correlated with throughput (reversing 2024) but still degrades stability: Faros telemetry (22k devs) shows +54% bugs/dev and +242.7% incidents/PR for AI-assisted code (f_dora_metrics_9). This makes AI-cohort segmentation of DORA metrics a first-class requirement.

**Lead time composition:** research shows the CCAB approval gate (24–48 h) accounts for approximately **84% of total lead time** in this SDLC (f_dora_metrics_14). Attributing that to "the pipeline" would be misleading; the gate latency must be instrumented separately to distinguish automation latency from human approval latency.

**Counting principle:** Argo CD syncs on dev/int/cert are **not deployments** for DORA. They are environment promotion steps. Counting them inflates deployment frequency 3–4× and understates lead time by anchoring it to a non-production sync (f_dora_metrics_1).

## Decision

Define **"deployment" for DORA purposes** as the conjunction of two events:

1. `promote-prod` GitHub Actions workflow concludes with `conclusion: success` for a specific image digest.
2. The corresponding Argo CD application on the prod cluster reaches `Synced+Healthy` state.

Both conditions must be true; a workflow success without Argo CD convergence (e.g., a failed sync due to a Kyverno denial) is **not a deployment**.

Instrument **five DORA events** using existing tooling, without deploying new infrastructure:

| Metric | Event | Source |
| --- | --- | --- |
| Deployment Frequency | `promote-prod workflow_run conclusion=success` | GitHub Actions webhook → OTel span |
| Lead Time | PR creation timestamp → Argo CD `Synced+Healthy` on prod | GitHub + Argo CD Prometheus |
| Change Failure Rate | PagerDuty incident opened within 1 h of prod deployment | PagerDuty → join on digest |
| FDRT | PagerDuty incident `resolved_at` − `triggered_at` | PagerDuty |
| Deployment Rework Rate | `rollback/prod` or `revert/prod` label on the promotion tracking issue | GitHub issue label event |

Add **`gate_N_duration_seconds`** telemetry at each promotion gate boundary (INT, CERT, CCAB) to expose the CCAB 24–48 h window as a separate, labeled metric — decoupling automation latency from approval latency in lead time dashboards (f_dora_metrics_14).

Segment all metrics by **AI authorship cohort** using the `AI-Authoring-Mode` confidence weight from ADR 0060 git-creep trailers. This provides the per-digest AI vs. human stability comparison the DORA 2025 AI-capabilities model requires (f_dora_metrics_10).

DORA metrics are computed on prod only. No new tooling required: GitHub Actions webhooks + Argo CD Prometheus metrics + PagerDuty → OTel pipeline → Datadog (or Grafana + Prometheus) (f_dora_metrics_16, f_dora_metrics_12).

## Implementation Details

- Configure GitHub Actions webhook to emit `workflow_run` events to the OTel collector on `promote-prod` completion.
- Add `argocd_app_sync_total{phase=Succeeded,env=prod}` Prometheus recording rule; join to the workflow event on image digest label.
- Instrument `gate_N_duration_seconds` as a GitHub Actions step-level metric: record `promoted_at` at gate entry; emit elapsed time with gate label on gate exit.
- Configure PagerDuty → Datadog incident ingestion; create a join rule: incidents opened within 60 minutes of a prod `promote-prod success` event are tagged as CFR events for that digest.
- Capture promotion tracking issue label events (`rollback/prod`, `revert/prod`) via GitHub webhook → rework-rate counter.
- Build a Datadog dashboard with five-metric lanes + AI-cohort overlay + gate-duration breakdown. Elite-tier thresholds (DF: multiple/day; LT: <1 h; CFR: 0–2%; FDRT: <1 h) as SLO annotations.

## Alternatives Considered

- **Count all Argo CD syncs (dev+int+cert+prod) as deployments.** Rejected: inflates DF 3–4×, understates LT; creates a misleading DORA picture (f_dora_metrics_1).
- **Count only the GitHub Actions workflow success as deployment (no Argo CD join).** Rejected: a workflow success that fails at Kyverno admission or Argo CD sync is not a delivery event; the joint definition is the only accurate one.
- **Commercial DORA platform (LinearB, Faros, Jellyfish).** Not adopted at this time; the five-event OTel pipeline satisfies DORA requirements at current scale. Reassess at >50 engineers where cross-team survey data and AI-cohort analytics justify the licensing cost (f_dora_metrics_12).
- **Exclude FDRT as a standalone metric (remain on 4-key).** Rejected: DORA 2025 promotes FDRT to standalone; alignment with current industry benchmarks requires the five-metric model (f_dora_metrics_13).

## Consequences

### Positive

- Unambiguous deployment definition; no gaming or overcounting.
- CCAB 24–48 h gate exposed as a labeled metric — the single highest-leverage lead-time reduction lever.
- AI-cohort segmentation enables evidence-based decision on where AI assistance is safe vs. destabilizing.
- Five-event pipeline uses existing GitHub + Argo CD + PagerDuty infrastructure; no new services.

### Risks / Negative

- Prod Argo CD `Synced+Healthy` may be delayed by slow canary analysis (Argo Rollouts); gate timing must account for canary duration to avoid false "deployment complete" signals.
- PagerDuty → digest join requires consistent digest labeling on PagerDuty incidents; an operational convention must be established.
- AI-cohort segmentation is only as good as ADR 0060 trailer coverage; commits without trailers fall into an "untracked" cohort that may skew stability metrics.

## Relationships

- **Depends on:** ADR 0056 (deployment event anchored to a verified prod digest promotion), ADR 0060 (AI-authoring-mode trailers provide cohort segmentation input).
- **Related:** ADR 0062 (GitHub Flow — deployment is anchored to the prod promote step, not a branch merge, consistent with the branching policy).

## Well-Architected Alignment

Operational Excellence
