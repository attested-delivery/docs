---
title: "Attestations That Survive Promotion"
description: "Signatures, SBOMs, and SLSA provenance attach to an image as separate OCI referrer manifests, not as layers. Copy the image by digest the naive way and you orphan all of it. Here is the trap and the fix."
---

You sign your images. You generate a software bill of materials. You attach SLSA provenance. Then you promote the image from your build registry to your production registry, by digest, the obvious way — and the deploy-time verification gate rejects it because none of the evidence is there. The image arrived. The signatures, the SBOM, and the provenance did not.

This is one of the most common ways an otherwise correct supply-chain setup quietly fails, and it comes down to a single fact about how attestations attach to images.

## Attestations are referrers, not layers

When you sign an image or attach an SBOM, the resulting artifact does not become part of the image. It becomes a *separate manifest* that points back at the image through a `subject` field. OCI calls this a referrer.

The OCI distribution spec defines the relationship: `subject` is "an association from one manifest to another, typically used to attach an artifact to an image." You discover what is attached to a digest by querying the Referrers API at `/v2/<name>/referrers/<digest>`, and "Upon success, the response MUST be a JSON body with an image index containing a list of descriptors," where each descriptor is a manifest "with a `subject` field that specifies the value of `<digest>`" ([OCI distribution-spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)).

The mental model that gets people into trouble is "the signature is on the image." It is not. The signature, the SBOM, and each attestation are independent manifests sitting next to the image in the same registry namespace, linked to it only by a back-reference. Picture a constellation of signed claims all pointing at one digest, rather than a single bundle you can move as a unit.

## The copy-by-digest trap

Now promote that image. The naive instinct is a plain image copy by digest — `crane cp` of the image digest, or any copy that moves only the manifest you named.

That copy does exactly what you asked: it transfers the image. It does not transfer the referrers, because they are separate manifests you did not name. They stay behind in the source registry. The image lands in the destination clean and naked; its signature, SBOM, and provenance are orphaned in the registry you copied *from*.

Everything still looks fine until the deploy gate runs. At admission, your policy asks the destination registry for the image's attestations, the registry has none to return, and the gate fails closed — correctly, because a missing attestation is a rejection. The evidence never arrived. You spend an afternoon convinced the signing step is broken when the signing step worked perfectly; the *copy* dropped the evidence on the floor.

## The fix: copy the referrers explicitly

Use a referrer-aware copy. With cosign, that means `cosign copy` with an explicit `--only` allow-list:

```sh
SRC=ghcr.io/ORG/REPO/my-service@sha256:DIGEST
DST=registry.int.example.com/ORG/REPO/my-service@sha256:DIGEST

cosign copy --only=sig,att,sbom "$SRC" "$DST"
```

The `--only` flag is a "custom string array to only copy specific items, this flag is comma delimited. ex: `--only=sig,att,sbom`" ([cosign copy options](https://github.com/sigstore/cosign/blob/main/cmd/cosign/cli/options/copy.go)). It copies signatures (`sig`), attestations (`att`), and SBOMs (`sbom`) alongside the image.

Pass `--only` explicitly. Do not rely on default-copy behavior to bring the evidence along. There is a reported regression in cosign v2.2.1 where `cosign copy` stopped copying signatures by default — a user reported that "2.2.1 doesn't copy or look for existing .sig artifacts without setting `-only sign`" and that as a result "I could no longer verify signatures on prod images because the signatures were missing" ([sigstore/cosign#3379](https://github.com/sigstore/cosign/issues/3379)). That is a single user-reported issue, not documented spec behavior, but it is a concrete reason to never depend on the implicit path. Being explicit removes the question entirely.

The `oras` equivalent for a recursive referrer copy is:

```sh
oras cp -r "$SRC" "$DST"
```

One registry caveat worth knowing before you commit to `oras cp -r`: as of 6 March 2026, Amazon ECR returns `405 Method Not Allowed` when an OCI 1.1 referrer manifest is pushed via recursive copy. The reported workaround — dropping `-r` — "successfully copies the image but excludes referrers, which breaks supply-chain attestation workflows" ([aws/containers-roadmap#2783](https://github.com/aws/containers-roadmap/issues/2783)). The lesson is general: an OCI 1.1 advertisement on a registry does not guarantee a working recursive referrer push. Validate referrer portability against your actual target registry, and prefer the explicit `cosign copy --only=...` form, which moves the attached artifacts deliberately.

## Gate the promotion on verification

Copying the referrers is half the job. The other half is proving they arrived, and that the artifact is what it claims to be, before you let the promotion succeed. Make the promotion conditional on `cosign verify-attestation`, run against the *destination* digest after the copy:

```sh
cosign verify-attestation "$DST" \
  --type slsaprovenance \
  --certificate-identity-regexp "https://github.com/ORG/REPO/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --policy policy.rego
```

`cosign verify-attestation` "has support of validating In-toto Attestations against `CUE` and `Rego` policies" ([cosign verify-attestation](https://docs.sigstore.dev/cosign/verifying/attestation/)). Running it after the copy, against the destination, is what confirms the evidence actually made the trip — not just that the image did.

This gate must fail closed. The Sigstore documentation is blunt about why: systems that verify attestations "must be carefully designed to work correctly if an attacker can delete or hide any specific attestation or set of attestations," and therefore "your systems should be designed to fail closed rather than open" ([cosign verify-attestation](https://docs.sigstore.dev/cosign/verifying/attestation/)). A missing attestation aborts the promotion. It never defaults to accept. An attacker who can strip an attestation must not thereby buy a pass.

## Confirm it worked

A non-zero exit from `cosign verify-attestation` should stop the promotion job outright. Independently confirm the referrers actually landed at the destination:

```sh
oras discover "$DST"   # lists attached signatures, SBOMs, attestations
```

If `oras discover` shows the signature, SBOM, and attestation manifests at the destination and `cosign verify-attestation` exits zero, the promotion preserved the full evidence chain. The same verification runs again at admission, so the property you established here — evidence travels with the digest — is the property the cluster will check before anything runs.

The rule to carry away: an image and its attestations are separate objects in the registry, joined only by a back-reference. Move the image alone and you have moved a stranger. Move the image *and* its referrers, then verify at the destination, and the thing that lands in production is the thing you actually vouched for.
