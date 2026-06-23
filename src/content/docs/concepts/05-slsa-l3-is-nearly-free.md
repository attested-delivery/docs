---
title: "SLSA Build Level 3 Is Nearly Free"
description: "If you already build with GitHub Artifact Attestations you are at SLSA Build Level 2. Getting to Level 3 is mostly a refactor: move the build-and-sign step into an isolated reusable workflow. Then declare your level and your SBOM format out loud."
diataxis_type: explanation
---

SLSA Build Level 3 sounds like a project. People hear "hardened builds" and imagine a dedicated isolated builder, a key management ceremony, an audit. If you build on GitHub Actions with Artifact Attestations, the reality is closer to a refactor you can land in an afternoon. You are most likely already at Level 2; the gap to Level 3 is one structural change to your workflow.

This post walks the build levels, shows the change that gets you to L3, and argues for one habit that costs nothing and pays off constantly: say your level and your SBOM format out loud.

## The levels, briefly

SLSA v1.1 defines three build levels, and they are graded by *adversary cost* — how hard it is to forge provenance or evade verification — not by which tool you use.

| Level | Name | Meaning (verbatim, slsa.dev/spec/v1.1/levels) |
| --- | --- | --- |
| L1 | Provenance exists | "Package has provenance showing how it was built. Can be used to prevent mistakes but is trivial to bypass or forge." |
| L2 | Hosted build platform | "Forging the provenance or evading verification requires an explicit 'attack', though this may be easy to perform." |
| L3 | Hardened builds | "Forging the provenance or evading verification requires exploiting a vulnerability that is beyond the capabilities of most adversaries." |

Source: [slsa.dev/spec/v1.1/levels](https://slsa.dev/spec/v1.1/levels)

The jump from L2 to L3 is the jump from "an attacker needs to mount an explicit attack, which might be easy" to "an attacker needs a vulnerability beyond most adversaries' reach." That is a real increase in assurance, and on GitHub Actions it is unusually cheap to claim honestly.

## Where you probably already are

GitHub Artifact Attestations, via `actions/attest-build-provenance`, give you SLSA v1.0 Build Level 2 out of the box: "Artifact attestations by itself provides SLSA v1.0 Build Level 2," signing and verifying through Sigstore ([docs.github.com — artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)). If you have wired that action into your build, you are at L2 today. You did not have to stand up a transparency log or manage a signing key — the keyless Sigstore flow handles both.

So the question is only what stands between L2 and L3.

## What L3 actually requires

First, a terminology correction, because it trips everyone. The phrase "reusable workflow" is *not* a SLSA term. It does not appear anywhere in the SLSA v1.1 specification. SLSA L3 is a requirement on the *build platform*: the platform must "prevent runs from influencing one another, even within the same project" and "prevent secret material used to sign the provenance from being accessible to the user-defined build steps" ([slsa.dev/spec/v1.1/levels](https://slsa.dev/spec/v1.1/levels)).

A reusable workflow is simply GitHub's documented implementation path to satisfy that isolation requirement on GitHub Actions. GitHub states it plainly: "Reusable workflows can provide isolation between the build process and the calling workflow, to meet SLSA v1.0 Build Level 3" ([docs.github.com](https://docs.github.com/en/actions/concepts/security/artifact-attestations)). Any platform that isolates runs from each other and keeps signing material out of user-controlled build steps satisfies L3; on GitHub Actions, the reusable workflow is how you get there.

## The change: isolate the build and sign step

Put the build-and-attest logic in its own workflow file that declares `workflow_call`. It owns the signing permissions; the caller never sees the signing material.

```yaml
# .github/workflows/build-and-attest.yml
name: build-and-attest

on:
  workflow_call:
    inputs:
      image-name:
        required: true
        type: string
    outputs:
      digest:
        value: ${{ jobs.build.outputs.digest }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write       # mint the OIDC token for the Sigstore signing certificate
      attestations: write   # persist the attestation
      contents: read
      packages: write       # push the image to GHCR
    outputs:
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v4

      - name: Build and push image
        id: push
        run: |
          IMAGE="ghcr.io/${{ github.repository }}/${{ inputs.image-name }}"
          docker build -t "$IMAGE" .
          DIGEST="$(docker push "$IMAGE" | awk '/digest:/ {print $3}')"
          echo "digest=$DIGEST" >> "$GITHUB_OUTPUT"

      - name: Generate build provenance attestation
        uses: actions/attest-build-provenance@v4
        with:
          subject-name: ghcr.io/${{ github.repository }}/${{ inputs.image-name }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

The calling workflow does no signing of its own. It invokes the reusable workflow with `uses:`, and that invocation is what creates the isolation boundary:

```yaml
# .github/workflows/release.yml
name: release

on:
  push:
    branches: [main]

jobs:
  build:
    uses: ./.github/workflows/build-and-attest.yml
    with:
      image-name: my-service
    permissions:
      id-token: write
      attestations: write
      contents: read
      packages: write
```

That is the whole structural change. The build and signing now run inside a workflow the caller cannot modify or observe, so the calling job cannot reach the OIDC token or influence the provenance. A standard single-job workflow that builds and attests in the same place gives you L2; this isolation pattern is what GitHub documents as the path to L3.

One thing not to skip: pin actions by commit SHA, not by mutable tag. A tag like `@v4` can be force-pushed to point at attacker code; a `@sha256`-pinned or commit-SHA-pinned action cannot move underneath you. The isolation buys you nothing if the action you call gets swapped.

Confirm the attestation exists and is bound to the digest you built:

```sh
gh attestation verify oci://ghcr.io/ORG/REPO/my-service@sha256:DIGEST -R ORG/REPO
```

## While you are there, attach an SBOM

The same isolated workflow is the right place to attach a software bill of materials, because the SBOM should describe the exact digest you just built and signed. CycloneDX 1.7 is the current release, published 21 October 2025 and superseding 1.6 ([cyclonedx.org](https://cyclonedx.org/news/cyclonedx-v1.7-released/)).

Generate it against the digest — never a mutable tag, which could be re-pointed after you scan:

```sh
syft "$IMAGE@$DIGEST" -o cyclonedx-json=./sbom.cdx.json
```

Then attach it as a referrer of the image, so it travels with the artifact:

```yaml
- name: Attest SBOM
  uses: actions/attest@v4
  with:
    subject-name: ghcr.io/${{ github.repository }}/my-service
    subject-digest: ${{ steps.push.outputs.digest }}
    sbom-path: ./sbom.cdx.json
    push-to-registry: true
```

`actions/attest` exposes a purpose-built `sbom-path` input — "Path to the JSON-formatted SBOM file (SPDX or CycloneDX) to attest" — which selects the correct predicate type for you ([actions/attest inputs](https://github.com/actions/attest)).

## Declare your level and your format

Here is the habit that costs nothing. Once you are at L3 and emitting a CycloneDX 1.7 SBOM, *say so* — in your release notes, in your README, in the metadata a downstream consumer reads. "Built at SLSA Build Level 3, SBOM in CycloneDX 1.7" is a single line, and it changes what a verifier downstream has to do.

The reason this is worth stating rather than leaving implicit: SLSA provenance is consumed by matching on a literal predicate type, not by reading a human label off a page. The canonical type is the literal string `https://slsa.dev/provenance/v1`, and the spec instructs consumers to "Always use the above string for `predicateType` rather than what is in the URL bar" ([slsa.dev/provenance/v1](https://slsa.dev/provenance/v1)). Your machine-readable provenance already carries the precise claim; declaring the level and format in human-facing material tells a consumer what to expect *before* they fetch and parse it, and tells an auditor what you assert without making them reverse-engineer your pipeline.

The end state is modest and concrete. Move one step into an isolated workflow, pin your actions, attach a current-format SBOM keyed to the digest, and write one line stating the level and format you produce. That is SLSA Build Level 3 on GitHub Actions — not a project, a refactor.
