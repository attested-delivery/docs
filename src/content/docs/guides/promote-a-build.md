---
title: "How to Promote a Build Across Environments"
description: "Move a built, signed, attested digest from one environment to the next without rebuilding, re-verifying at each hop to keep the attestation chain intact."
diataxis_type: how-to
diataxis_goal: "A build produced in CI is promoted through staging and into production by digest, with attestations verified at each hop and the artifact never rebuilt."
---

Promotion means moving the exact digest that CI built, signed, and attested from one environment to the next. It never means rebuilding. A rebuild produces a new digest and orphans every attestation made about the old one.

For the concepts behind this constraint, see [The Digest Is the Release](/docs/concepts/01-the-digest-is-the-release) and [Attestations That Survive Promotion](/docs/concepts/03-attestations-that-survive-promotion).

## Prerequisites

- `cosign` installed; authenticated to the source and destination registries
- `gh` CLI installed and authenticated with read access to the attesting repository
- The digest (`sha256:...`) from CI — captured as a job output, never inferred from a tag at promote time

## 1. Confirm the digest before you copy

Before touching the destination registry, verify the attestations on the source digest from the current environment:

```sh
DIGEST="sha256:<the-digest-ci-produced>"
SOURCE="ghcr.io/attested-delivery/<repo>@${DIGEST}"

# SLSA provenance — signer is the central sign-and-attest.yml
gh attestation verify "oci://${SOURCE}" \
  --repo attested-delivery/<repo> \
  --signer-workflow attested-delivery/.github/.github/workflows/sign-and-attest.yml \
  --predicate-type https://slsa.dev/provenance/v1

# SBOM
cosign verify-attestation "${SOURCE}" \
  --type cyclonedx \
  --certificate-identity-regexp \
    '^https://github\.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

If either fails, stop. Do not proceed to copy. Diagnose why the attestations do not verify at the source before moving the digest anywhere.

## 2. Copy the digest by digest, carrying referrers

Copy the image to the destination registry using `cosign copy`, which carries OCI referrers (signature, SBOM, and attestation referrers) alongside the manifest:

```sh
cosign copy \
  "${SOURCE}" \
  "<dest-registry>/attested-delivery/<repo>@${DIGEST}"
```

Do not use `docker pull` + `docker push`, which copies the image layers but drops referrers and leaves the destination without its attestation chain.

If your destination is a tag-addressed target (for example `staging-registry/app:staging`), include the tag in the destination but keep the digest as the copy source:

```sh
cosign copy \
  "${SOURCE}" \
  "<dest-registry>/attested-delivery/<repo>:staging"
# The digest is preserved in the destination manifest; the tag is a pointer to it.
```

## 3. Re-verify at the destination

After the copy completes, re-run verification against the destination digest. The digest must be identical to the source digest — attestations are digest-bound and do not transfer if the bytes changed:

```sh
DEST="<dest-registry>/attested-delivery/<repo>@${DIGEST}"

gh attestation verify "oci://${DEST}" \
  --repo attested-delivery/<repo> \
  --signer-workflow attested-delivery/.github/.github/workflows/sign-and-attest.yml \
  --predicate-type https://slsa.dev/provenance/v1

cosign verify-attestation "${DEST}" \
  --type cyclonedx \
  --certificate-identity-regexp \
    '^https://github\.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

If the gate-verdict attestations (SAST, SCA, etc.) are required at the destination, verify each one as well. See [How to Verify a Release](/docs/guides/verify-a-release) for the per-gate commands.

## 4. Wire the verification step into your promotion workflow

The `verify-attestation.yml` central reusable runs the full verification set (keyless signature, SLSA provenance, SBOM) in-pipeline. Add it as a job between the copy step and any deploy job:

```yaml
jobs:
  promote:
    # ... your copy step here

  verify-at-destination:
    needs: [promote]
    permissions:
      id-token: write
      contents: read
      packages: read
      attestations: read
    uses: attested-delivery/.github/.github/workflows/verify-attestation.yml@<GITHUB_SHA> # vX.Y.Z
    with:
      image-ref: <dest-registry>/attested-delivery/<repo>@${{ needs.promote.outputs.digest }}
      attestation-repo: attested-delivery/<repo>

  deploy:
    needs: [verify-at-destination]
    # ...
```

The deploy job runs only if `verify-at-destination` exits 0. If verification fails at the destination, the deploy job is blocked.

For the full input contract of `verify-attestation.yml`, see [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/).

## 5. If you require a change record before promoting to production

For production promotions that require an approved change record, gate the promote job on that approval before the `cosign copy` step executes. The approved record must reference the same digest being promoted — verify the three-way equality: the digest in the change record, the digest at the source registry, and the digest at the destination after copy.

This is caller-implemented; there is no central `promote.yml` reusable. Wire the gate as an `if:` condition or an environment protection rule in the promote job, depending on your platform.

## Verification

A promotion is complete and correct when:

1. `cosign copy` exits 0.
2. `gh attestation verify` exits 0 at the destination, printing `✓ Verification succeeded!`
3. `cosign verify-attestation --type cyclonedx` exits 0 at the destination.
4. The digest at the destination is byte-for-byte identical to the digest CI produced.

Check exit codes directly — do not pipe output and grep for a success string. A pipe that matches nothing is silent; silence is not success.

## Troubleshooting

**`cosign copy` succeeds but `gh attestation verify` fails at the destination.** The referrers were not carried. Confirm you used `cosign copy`, not a `docker pull` + `docker push` round-trip. Also confirm the destination registry supports OCI referrers; registries that do not implement the referrers API drop them silently.

**The digest at the destination differs from the source digest.** The image was rebuilt or re-pushed rather than copied. A rebuild produces a new digest and orphans all attestations. Identify where the rebuild occurred and replace it with a `cosign copy`.

**Promotion to production is blocked by a missing change-record check.** Confirm the change record was created and approved before the promotion job ran, and that the digest field in the record matches `${DIGEST}` exactly (character-for-character, including the `sha256:` prefix).

**`cosign verify-attestation --type cyclonedx` matches nothing at the destination.** The SBOM referrer was not copied. This can happen with registries that partially implement the OCI referrers API. Check whether the destination registry lists referrers for the digest:
```sh
cosign triangulate "<dest-registry>/attested-delivery/<repo>@${DIGEST}"
```

## Related

- [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/)
- [Concept: The Digest Is the Release](/docs/concepts/01-the-digest-is-the-release)
- [Concept: Attestations That Survive Promotion](/docs/concepts/03-attestations-that-survive-promotion)
- [Concept: Enforce at Admission, Not by Convention](/docs/concepts/04-enforce-at-admission-not-by-convention)
- [Concept: Honest DORA — Defining Deployment](/docs/concepts/08-honest-dora-defining-deployment)
- [How to Verify a Release](/docs/guides/verify-a-release)
- [How to Wire Attested Quality Gates into a Repository](/docs/guides/onboard-a-repo)
