---
title: "The Digest Is the Release"
description: "A container tag is a mutable pointer. The thing you verified and the thing you run can silently differ. Identify the release by its content digest instead, build once, and promote that exact digest everywhere."
---

A team I worked with chased a production bug for two days. The image tag in the cluster matched the tag they had tested. The behavior did not. Somewhere between the test environment and production, `myservice:release-2026.05` had been rebuilt, and the rebuild pulled a transitive dependency that had shipped a regression that morning. Same tag. Different bytes. Nobody lied; the tag just moved.

That is the failure mode this post is about, and the fix is one sentence: stop treating the tag as the release identity, and start treating the content digest as the release identity.

## A tag is a label, not an identity

A container image is identified by its content digest, not by its tag. The OCI image specification is precise about this. The digest property of a descriptor "acts as a content identifier, enabling content addressability," and "it uniquely identifies content by taking a collision-resistant hash of the bytes" ([OCI image-spec descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)).

Two properties follow, and they do all the load-bearing work:

- The same bytes always produce the same digest. A digest like `sha256:2d0586…` names exactly one sequence of bytes.
- Different bytes always produce a different digest. You cannot change the content without changing the name.

The spec spells out the consequence for verification: "If the *digest* can be communicated in a secure manner, one can verify content from an insecure source by recalculating the digest independently, ensuring the content has not been modified" ([OCI image-spec descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)).

A tag has none of that. `myimage:latest` can point at one set of bytes today and a different set tomorrow. The pointer is convenient for humans — `v2.4`, `stable`, `release-2026.05` are easier to type and read than 64 hex characters. But convenience is the whole of what a tag offers. It carries no guarantee that the thing behind the label is the thing you verified. Treat the tag as exactly that: a label you hang on a digest, never the identity itself.

## Build once, promote many

If the digest is the identity, the artifact has to be built exactly once. One build in CI produces one digest, and that digest is what moves through every environment — dev, integration, staging, production. Promotion does not rebuild. It copies the same digest forward and re-verifies it.

The alternative — rebuilding per environment, "to be safe" — breaks the model immediately. A rebuild produces new bytes: different timestamps, freshly resolved transitive dependencies, possibly a build tool that was compromised in the hours since the last build. New bytes mean a new digest. The thing you verified in staging is no longer the thing you run in production. That is precisely the two-day bug from the top of this post, just with the rebuild made explicit instead of accidental.

Build-once-promote-many is not a performance optimization, though it is faster. It is the precondition for any claim you make about an artifact to still be true by the time that artifact reaches production.

## Why this is the precondition for everything else

Here is the part that is easy to miss. The reason the digest-as-identity rule matters so much is that everything else you might want to say about a release is a statement *about a specific digest*.

When you record how an artifact was built, that provenance refers to a digest. SLSA's provenance predicate is bound to the built artifact; its canonical type is the literal string `https://slsa.dev/provenance/v1`, and the spec tells consumers to "Always use the above string for `predicateType` rather than what is in the URL bar" ([SLSA provenance v1](https://slsa.dev/provenance/v1)). When you record what a build contained, that software bill of materials refers to a digest. When you record that a build passed its tests, the in-toto test-result predicate carries a required `result` field that is "One of `PASSED`, `WARNED`, or `FAILED`" ([in-toto test-result predicate](https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md)) — and that result is a claim about a digest.

Now run the rebuild scenario against those claims. You signed a provenance statement in CI that says "this digest was built this way, by this workflow, and passed these tests." Then promotion rebuilt the image. Production is running a *different* digest. Your signed statement is still real — the signature verifies, the transparency log entry exists — and it is describing bytes that never reached production. You are holding a genuine certificate about the wrong artifact. The certificate is real and worthless at the same time.

Byte-identical promotion closes that gap. Because the digest in production is the digest CI built and signed, the provenance, the bill of materials, and the test results apply directly to the thing that is actually running. The claims travel with the digest precisely because the digest never changes.

## What this looks like in practice

Three habits make the model hold, and all three are cheap.

**Pin by digest, not by tag, everywhere it matters.** Sign by digest. Generate your SBOM against the digest. Reference the digest in your deployment manifest:

```yaml
spec:
  template:
    spec:
      containers:
        - name: example
          image: registry.example.com/example@sha256:PRIOR_VERIFIED_DIGEST
```

A tag in that manifest reintroduces drift; a digest does not.

**Promote the digest, do not rebuild it.** Your promotion step is a copy plus a re-verify, not a `docker build`. Move the exact digest forward and confirm its evidence arrived at the destination.

**Roll back to a digest, too.** A rollback target is just a prior verified digest. In a GitOps setup, that is a revert of the commit that pinned the bad digest, restoring the manifest to the previous one:

```sh
git revert --no-edit <commit-that-introduced-bad-digest>
git push origin main
```

The cluster reconciles to the prior digest, and that digest passes the same admission verification as any other image — a rollback target earns no trust just because it ran before.

## The short version

Tags are for humans. Digests are for machines, and machines are what move your code to production. The release is not the branch you cut it from and not the tag you stuck on it. The release is the digest. Build it once, verify it once, and promote that exact set of bytes the whole way out. Every signature, every bill of materials, every passing test you attach to it stays true only because the bytes never change underneath you.
