---
title: "Enforce at Admission, Not by Convention"
description: "A signature created in CI is a claim, not a guarantee that the signed image is the one running in your cluster. The difference is where you enforce. Put a deny-by-default, fail-closed check at the admission boundary."
---

Your CI pipeline signs every image it builds. Good. Now answer this: what stops someone from `kubectl apply`-ing a different, unsigned image straight into the cluster? If the answer is "nobody would do that" or "our deploy script always signs," you have a convention, not a control. The signature your pipeline produced is sitting in a registry, and nothing is forcing the path into your cluster to consult it.

The fix is to move enforcement to the one place every deployment has to pass through: the admission boundary.

## A build-time signature is not a deploy-time guarantee

When CI signs an artifact, it asserts something true about that artifact at that moment: this digest was built this way, contained these components, passed these tests. With Sigstore's keyless model that assertion is strong — "Fulcio issues short-lived certificates binding an ephemeral key to an OpenID Connect identity," "the private key is destroyed shortly after and the short-lived identity certificate expires," and "Signing events are logged in Rekor, a signature transparency log, providing an auditable record of when a signature was created" ([Sigstore signing overview](https://docs.sigstore.dev/cosign/signing/overview/)).

Notice what that assertion does *not* do. It does not stop someone from deploying a different, unsigned image. It does not stop an image whose signature was created but whose attestations were stripped during a registry copy. It does not stop a stale, vulnerable digest that was signed months ago and never re-evaluated. The signature exists; nothing in the deploy path is obligated to look at it.

If the only thing between "signed in CI" and "running in production" is a convention — a pipeline step everyone agrees to run, a checklist item, a well-behaved deploy script — then your guarantee is exactly as strong as the weakest path into the cluster. Any deploy that bypasses the pipeline bypasses the guarantee. A 3 a.m. `kubectl set image` during an incident bypasses it. Convention is not enforcement.

## Enforce at the choke point

The decisive gate is the Kubernetes admission controller. It is the choke point through which *every* deployment passes — pipeline-driven or hand-typed, well-behaved or not. Enforce here and the guarantee stops depending on the deploy path being trusted, because there is no deploy path that skips admission.

Kyverno's `ImageValidatingPolicy` does this enforcement, and it is now a stable API. It was promoted to a stable `v1` API in Kyverno 1.17, released 2 February 2026: "the promotion of CEL-based policy types to v1 … specifically includes ImageValidatingPolicy" ([Kyverno 1.17](https://kyverno.io/blog/2026/02/02/announcing-kyverno-release-1.17/)). The policy verifies signatures and attestations at admission using CEL functions such as `verifyImageSignatures(image, [attestors])` and `verifyAttestationSignatures(image, attestations, [attestors])` ([Kyverno ImageValidatingPolicy](https://kyverno.io/docs/policy-types/image-validating-policy/)).

Here is a policy that admits a pod only if its image is keyless-signed *and* carries a SLSA build-provenance attestation from a specific builder identity:

```yaml
apiVersion: policies.kyverno.io/v1
kind: ImageValidatingPolicy
metadata:
  name: require-signed-slsa-provenance
spec:
  validationActions: [Audit]          # start in Audit; switch to Deny after soak
  webhookConfiguration:
    failurePolicy: Fail               # fail closed if the webhook cannot evaluate
    timeoutSeconds: 15
  matchConstraints:
    resourceRules:
      - apiGroups: ['']
        apiVersions: ['v1']
        resources: ['pods']
        operations: ['CREATE', 'UPDATE']
  matchImageReferences:
    - glob: 'ghcr.io/myorg/*'
  attestors:
    - name: githubBuilder
      cosign:
        keyless:
          identities:
            - issuer: 'https://token.actions.githubusercontent.com'
              subject: 'https://github.com/myorg/myrepo/.github/workflows/build-and-attest.yml@refs/heads/main'
  attestations:
    - name: slsaProvenance
      intoto:
        type: https://slsa.dev/provenance/v1
  validations:
    - expression: >-
        images.containers.map(image,
          verifyImageSignatures(image, [attestors.githubBuilder])).all(e, e > 0)
      message: 'Image signature verification failed'
    - expression: >-
        images.containers.map(image,
          verifyAttestationSignatures(image, attestations.slsaProvenance, [attestors.githubBuilder])).all(e, e > 0)
      message: 'SLSA provenance attestation verification failed'
```

Pinning the keyless `subject` to a specific signing workflow's ref is what binds admission to a *builder identity*: only attestations produced by that exact workflow satisfy the policy. A signature from some other workflow, or no signature at all, does not get in. Use the literal predicate string `https://slsa.dev/provenance/v1` — the SLSA spec says "Always use the above string for `predicateType` rather than what is in the URL bar" ([slsa.dev/provenance/v1](https://slsa.dev/provenance/v1)).

This is not Kyverno-specific dogma. Other admission verifiers implement the same shape; the Sigstore policy-controller, for example, admits an image only "after it has been validated against all `ClusterImagePolicy` that matched the digest," rejecting matched-but-unsatisfied images by default ([policy-controller](https://docs.sigstore.dev/policy-controller/overview/)).

## Deny plus Fail — the two settings that matter

Two settings turn the policy from advisory into binding.

`validationActions: [Deny]` makes a violation a hard rejection. An image that lacks a valid signature or a required attestation is refused entry to the cluster.

`failurePolicy: Fail` makes the webhook itself fail closed. If the policy cannot be evaluated — the webhook times out, the verifier is unreachable — the request is rejected rather than admitted. Per the Kyverno docs, `Deny` "enforces hard rejection," and `failurePolicy: Fail` ensures that "if the policy cannot be evaluated the request is rejected rather than admitted" ([Kyverno ImageValidatingPolicy](https://kyverno.io/docs/policy-types/image-validating-policy/)).

The combination matters. `Deny` without `Fail` leaves a gap: an attacker who can knock the webhook offline gets a free pass, because an unevaluated request sails through. `Deny` plus `Fail` closes it. A missing attestation is a rejection, and an unanswerable question is a rejection too.

## Roll it out Audit first, then Enforce

Do not turn on `Deny` cold. You will block legitimate workloads you forgot about — an image from a registry that does not match your glob, a service still signed by an older workflow ref, a third-party sidecar — and you will spend the outage learning which.

Start in Audit. With `validationActions: [Audit]`, violations are logged without blocking pods, so you find the false negatives — correctly-signed images that fail to match for some reason you did not anticipate — without breaking anything. Apply it and let it soak across a representative deploy window, then read the reports:

```sh
kubectl get policyreport -A
```

When the Audit reports are clean, flip to enforcement:

```yaml
spec:
  validationActions: [Deny]
  webhookConfiguration:
    failurePolicy: Fail
```

Then prove both directions: a signed, attested image is admitted, and an unsigned one is rejected.

```sh
# should succeed (signed + SLSA provenance from the pinned builder)
kubectl run good --image=ghcr.io/myorg/my-service@sha256:GOOD_DIGEST

# should be rejected in Deny mode
kubectl run bad --image=docker.io/library/nginx:latest
# Error: ... admission webhook denied the request: Image signature verification failed
```

## Why this is the right boundary

SLSA frames the whole exercise as adversary cost. Its build levels are graded by how hard forgery is: L2 means "Forging the provenance or evading verification requires an explicit 'attack'," and L3 means forging "requires exploiting a vulnerability that is beyond the capabilities of most adversaries" ([SLSA build levels](https://slsa.dev/spec/v1.1/levels)).

But that cost only buys you something if someone actually verifies — and SLSA's own verification guidance is non-binding "SHOULD" language. Verification "SHOULD include the following steps," and may happen at upload, download, or via continuous monitoring, with "at least one SHOULD be used" ([SLSA verifying-artifacts](https://slsa.dev/spec/v1.0/verifying-artifacts)).

The standard tells you to verify. It cannot force *your* cluster to. That last mile is yours, and a deny-by-default, fail-closed admission policy is what walks it. Build-time attestation establishes the claim. Admission-time enforcement is what makes the claim binding on what actually runs. Everything between those two points is convention, and convention is what an incident, a mistake, or an attacker routes around.
