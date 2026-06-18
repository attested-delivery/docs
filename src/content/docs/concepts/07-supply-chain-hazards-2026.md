---
title: "Supply-Chain Hazards That Got Real in 2026"
description: "The trivy-action compromise, why mutable tags are the bug, the Rekor v2 shard rotation that breaks old cosign, and how promotion silently orphans your attestations."
---

For a long time "supply-chain security" was an abstraction you nodded at in a threat model and then ignored. In March 2026 it stopped being abstract. The tool a lot of teams use to scan their images for vulnerabilities was turned into a credential thief, and it happened through a mechanism every CI pipeline relies on without thinking: the mutable git tag. Here are the hazards that became concrete this year and the specific changes that defend against each.

## The scanner itself got compromised

The Trivy ecosystem was compromised — CVE-2026-33634, tracked as GHSA-69fq-xp46-6x23. The advisory is blunt about the scope: in `trivy-action`, "76 of 77 version tags force-pushed to malicious commits," and in `setup-trivy`, "All 7 existing tags (v0.2.0 – v0.2.6) were force-pushed to malicious commits." Malicious binaries and Docker images were published alongside.

The payload was not subtle. It "Dumps Runner.Worker process memory via `/proc/<pid>/mem` to extract secrets" and "Sweeps 50+ filesystem paths for SSH keys, AWS/GCP/Azure credentials, Kubernetes tokens, Docker configs, .env files, database credentials." As a fallback, it "creates a public tpcp-docs repository on the victim's GitHub account and uploads stolen data as a release asset" ([GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)).

Sit with the shape of this. The thing scanning your images for compromise was the compromise. Every secret your CI runner could see — cloud credentials, cluster tokens, signing keys — was in scope, and the exfiltration had a fallback path that did not even need an attacker-controlled server. The safe versions, per the advisory, are Trivy v0.69.2 or v0.69.3, `trivy-action` v0.35.0, and `setup-trivy` v0.2.6.

## The actual bug was trusting a mutable tag

It is tempting to file this under "Trivy got hacked, glad I don't use it." That misses the point. The attack worked because workflows referenced tags like `v0.35.0`, and a force-push silently re-pointed that tag at a malicious commit. Nothing in the referencing workflow changed. The next run just pulled different code. Any action you reference by tag is exposed to exactly this.

The fix is to pin by immutable identity, and the right form depends on what you are pinning.

GitHub Actions are git references; they have no content digest. Pin them by full commit SHA. A SHA cannot be force-pushed out from under you — it is the content.

```yaml
# Not this — the tag can be re-pointed:
- uses: aws-actions/configure-aws-credentials@v4
# This — the commit is immutable:
- uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502
```

Container images and tool binaries delivered as OCI artifacts get pinned by content digest — the `sha256:` identifier defined by the OCI image-spec descriptor ([OCI image-spec](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)).

```yaml
# Pin the base image by digest, not by tag:
FROM alpine@sha256:...
```

"Pin by digest" is shorthand for "pin to whichever immutable identity the artifact type provides." For actions that is the commit SHA; for images it is the content digest. Both remove the mutable tag from the trust path, which is the only thing that made the March attack possible. Yes, it makes upgrades a deliberate, reviewed step instead of a silent background slide. That is the feature, not the cost.

## Keyless signing changed shape under you

If you sign artifacts keyless with Sigstore, the transparency log you write to changed in late 2025, and pipelines that assumed the old behavior break.

Rekor v2 reached general availability on 10 October 2025. The new log "periodically rotate[s] the log instance, and while we'll publicly communicate when we spin up a new log, we will also freeze the previous log instance shortly afterwards." It supports only two entry types now — "The artifact `hashedrekord` entry type and the attestation `dsse` entry type are the two supported types in Rekor v2" — and "The search index has been removed." Signed timestamps moved out of the log entirely: "The log no longer returns signed timestamps with proofs. Sigstore clients will fetch a signed timestamp from a dedicated service" ([Rekor v2 GA](https://blog.sigstore.dev/rekor-v2-ga/)).

Three operational consequences fall out of that:

- **Your client has to be current.** The same announcement states: "We have added support for Rekor v2 upload and verification to Cosign v2.6.0." Require cosign 2.6.0 or newer. Older clients cannot transact with the new log at all.
- **Rotation is periodic, not annual.** The previous log instance is frozen shortly after a new one spins up. Verification has to tolerate entries that live in a frozen prior shard. Do not hard-code an assumption that rotation happens once a year on a known date — the source says "periodically." Build re-anchoring into your tooling maintenance as a routine event, not a yearly surprise.
- **Stop depending on the removed search index.** Reference entries by their own identifiers. Anything that searched the log to find an entry is broken.

## Promotion silently orphans your attestations

You did everything right: generated an SBOM, produced provenance, signed the image, attached it all. Then you promoted the image from one registry to the next, and your fail-closed admission gate rejected it in production because the attestations were gone. What happened?

Attestations attach to an image as OCI referrers — separate manifests linked to the target only by a `subject` field ([OCI distribution-spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)). They are sibling manifests, not layers of the image. So a naive image-only copy by digest moves the image and orphans the referrers, which stay behind in the source registry. The provenance, SBOM, and signatures simply do not make the trip.

The defense is a referrer-aware copy. `cosign copy` is built for this, and its `--only` flag is "comma delimited. ex: `--only=sig,att,sbom`" — signatures, attestations, and SBOMs ([cosign copy source](https://github.com/sigstore/cosign/blob/main/cmd/cosign/cli/options/copy.go)). Pass it explicitly:

```sh
cosign copy --only=sig,att,sbom \
  src-registry/my-service@sha256:DIGEST \
  dst-registry/my-service@sha256:DIGEST
```

Two cautions reinforce being explicit. A regression in cosign v2.2.1 caused `cosign copy` to stop copying signatures by default, and a user reported they "could no longer verify signatures on prod images because the signatures were missing" ([cosign issue 3379](https://github.com/sigstore/cosign/issues/3379)). Relying on the implicit default is how you get bitten. And registry support for OCI 1.1 referrer transfer is uneven: as of 6 March 2026, Amazon ECR returns "405 Method Not Allowed" when an OCI 1.1 referrer manifest is pushed via recursive copy, and the workaround of dropping recursion "successfully copies the image but excludes referrers, which breaks supply-chain attestation workflows" ([ECR referrer issue](https://github.com/aws/containers-roadmap/issues/2783)).

The lesson across all three of the latter hazards is the same: copying the image is not the same as copying its attestation graph, and verifying once is not the same as verifying everywhere. After every promotion, list the referrers at the destination and confirm they actually arrived. Trust the digest, verify the graph.
