---
title: "Honest DORA: Define a Deployment First"
description: "Every DORA metric counts deployments, but DORA never defines one. Pin it down, instrument all five metrics, decompose lead time per gate, and segment by AI cohort."
---

Two teams report deployment frequency. One counts every merge to `main`. The other counts only the moment a verified artifact reaches a healthy running state in production. Their numbers are not comparable, and neither is wrong — they are answering different questions while using the same word. This is the quiet flaw in most DORA dashboards: every metric is built on "a deployment," and almost nobody defines what that is.

Here is the uncomfortable detail. DORA's own Four Keys guide enumerates the metrics but does not give a standalone definition of what a deployment is ([dora.dev](https://dora.dev/guides/dora-metrics-four-keys/)). That is not an oversight you can route around. It means the definition is an operational choice you have to make explicitly, and if you skip it, your metrics inherit whatever implicit definition your tooling happened to encode. Honest DORA starts by writing the definition down.

## Pin the definition before you measure anything

A workable definition for a pipeline that promotes container images: a deployment is a production promotion of a content digest that reaches a healthy running state. Both halves carry weight.

"Promotion of a content digest" means the event being counted is the specific moment a verified `sha256:` digest is admitted to production. Not a merge. Not a CI build. Not a manifest push. The exact, attested artifact that runs. This keeps the metric anchored to the thing that actually serves traffic rather than to an intention upstream of it.

"Reaches a healthy running state" means a promotion that is admitted but never becomes healthy is not a completed deployment. Healthiness is observable from your GitOps controller. Argo CD "continuously monitors running applications and compares the current, live state against the desired target state," surfacing health and marking divergence `OutOfSync` ([Argo CD](https://argo-cd.readthedocs.io/en/stable/)). The deployment is counted when the promoted digest is synced and healthy — not when the pods were scheduled, not when the rollout started.

This definition is yours to make; DORA supplies the metric framework and the GitOps controller supplies the healthiness signal. The payoff is that deployment frequency, lead time, and recovery time all count the same well-defined event instead of three subtly different ones.

## There are five metrics, not four

The "Four Keys" name is sticky, but the current model has five, grouped into two families that pull against each other ([dora.dev](https://dora.dev/guides/dora-metrics-four-keys/)).

Throughput:

- **Change lead time** — "The amount of time it takes for a change to go from committed to version control to deployed in production."
- **Deployment frequency** — "The number of deployments over a given period or the time between deployments."
- **Failed deployment recovery time** — "The time it takes to recover from a deployment that fails and requires immediate intervention."

Instability:

- **Change fail rate** — "The ratio of deployments that require immediate intervention following a deployment."
- **Deployment rework rate** — "The ratio of deployments that are unplanned but happen as a result of an incident in production."

The grouping is explicit in the source: "throughput (change lead time, deployment frequency, failed deployment recovery time) and instability (change fail rate, deployment rework rate)." The two families are in tension by design — going faster tends to stress stability. That tension is the entire reason you measure both. Report a single composite "DORA score" and you have averaged away the one thing the metrics exist to expose.

A note on what I am deliberately not telling you: I am not quoting performance-tier bands or a target change-fail-rate percentage. Set every threshold from your own service's baseline. The five-metric structure is the standard; the benchmark numbers that float around are not something to import wholesale.

## Decompose lead time so it tells you where to look

"Change lead time is 18 hours" is a number you cannot act on. The actionable version is a breakdown: how much of those 18 hours was build, how much was waiting for a review, how much was sitting in a change-approval gate.

End-to-end pipeline timing can ride on the OpenTelemetry CI/CD semantic conventions. `cicd.pipeline.run.duration` is "Duration of a pipeline run grouped by pipeline, state and result," and span attributes like `cicd.pipeline.result` and `cicd.pipeline.task.run.result` carry the outcome ([OpenTelemetry CI/CD metrics](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/)). Worth knowing: those conventions are at Development status, not yet stable, and they define no `deployment.*` metric — DORA keys have to be derived from the `cicd.*` pipeline signals plus your own deployment metadata.

For the gates that are not pipeline tasks — the change record, approvals, a change-advisory step — add a per-gate duration metric of your own. Wrap each gate, record the elapsed time, and tag it with the gate name and the digest:

```bash
GATE_START=$(date +%s)
# ... gate runs (e.g. await approval) ...
GATE_END=$(date +%s)
otel-cli metric \
  --name gate_duration_seconds \
  --value "$(( GATE_END - GATE_START ))" \
  --attrs "gate.name=cab,digest=sha256:${DIGEST}"
```

The validation that this is wired correctly: the sum of per-gate durations plus pipeline run duration should reconcile against the commit-to-healthy-deploy lead time for the same digest. When they reconcile, you can finally point at the slow gate instead of guessing.

## Segment by AI cohort or the signal cancels out

If AI is writing or assisting a meaningful share of your changes, a single blended DORA number is now actively misleading, and DORA's own 2025 research says why.

The 2025 report finds AI pulling throughput and stability in opposite directions. On throughput: "we observe a positive relationship between AI adoption on both software delivery throughput and product performance." On stability: "AI adoption does continue to have a negative relationship with software delivery stability" ([2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)).

The report frames AI as "the great amplifier" whose "primary role is as an amplifier, magnifying an organization's existing strengths and weaknesses," and warns that "AI accelerates software development, but that acceleration can expose weaknesses downstream. Without robust control systems, like strong automated testing, mature version control practices, and fast feedback loops, an increase in change volume leads to instability" ([DORA 2025](https://dora.dev/research/2025/dora-report/)).

Now look at what a blended metric does to that. If AI pushes throughput up and stability down, averaging the AI-assisted and human-only changes together hides both effects. Your deployment frequency ticks up, your change fail rate ticks up, and the dashboard shows a muddy wash that tells you nothing about cause. Segment by cohort instead — record per change whether and how AI assisted, then report the five metrics separately for the AI-assisted cohort and the rest. Now you can watch throughput rise in the AI cohort while watching change fail rate and rework rate in that same cohort, and decide whether your testing, your version-control discipline, and your admission gates are holding the line. That is the difference between steering the amplifier and merely watching it.

For the cohort label to be trustworthy, it has to be recorded as fact at authoring time — a dedicated commit trailer, carried forward into signed build provenance — not reverse-engineered after the deployment. Guessing which changes were AI-assisted after the fact gives you a cohort split as noisy as the metric it was supposed to clarify. Capture it at the commit, and the segmentation rests on something real.
