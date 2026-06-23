---
title: "How to Independently Verify a Release's Attestations"
description: "Re-run attestation verification from a clean workstation against a published digest to confirm the release is what CI built, signed, and attested."
diataxis_type: how-to
diataxis_goal: "A release's SLSA provenance, signature, SBOM, and gate-verdict attestations are verified independently from a workstation, confirming the artifact is what CI built and no attestation is forged or missing."
---

In-pipeline green is necessary, but it is not the acceptance test. The acceptance test is independent verification: downloading the artifact and running `gh attestation verify` from a clean workstation against the published digest. This guide walks through that process for each attestation type produced by the attested-delivery pipeline.

For the concepts behind why independent verification matters, see [Attestations That Survive Promotion](/docs/concepts/03-attestations-that-survive-promotion) and [SLSA L3 Is Nearly Free](/docs/concepts/05-slsa-l3-is-nearly-free).

## Prerequisites

- `gh` CLI installed and authenticated with at least read access to the target repository
- `cosign` installed (for keyless signature and SBOM verification)
- For private images, a GHCR login:
  ```sh
  gh auth token | docker login ghcr.io -u <username> --password-stdin
  ```

## 1. Download the artifact

### Container images

Resolve the digest for the tag you want to verify:

```sh
DIGEST=$(gh api 'orgs/attested-delivery/packages/container/<repo>/versions?per_page=100' \
  --jq '[.[] | select((.metadata.container.tags // []) | index("<tag>"))][0].name')
echo "$DIGEST"   # should print sha256:...
```

If the output is `null`, increase `per_page` — the default of 20 silently omits older tags.

### Binary and bundle releases

```sh
gh release download <tag> --repo attested-delivery/<repo>
```

All release artifacts, their checksums file, and any bundles are downloaded to the current directory.

## 2. Verify SLSA provenance

### Container images

Under SLSA Build L3 the Fulcio SAN is the **signer workflow** (the central `sign-and-attest.yml`), not the source repository alone. Both `--repo` and `--signer-workflow` are required; `--repo` alone is insufficient and fails under L3.

```sh
gh attestation verify "oci://ghcr.io/attested-delivery/<repo>@${DIGEST}" \
  --repo attested-delivery/<repo> \
  --signer-workflow attested-delivery/.github/.github/workflows/sign-and-attest.yml \
  --predicate-type https://slsa.dev/provenance/v1
```

### Binaries and bundles

For static artifacts, provenance is signed by the repo's own release workflow (not the central signer). Pin both `--signer-workflow` and `--predicate-type` — with `--repo` alone, any provenance producer in the repo (e.g. `dast.yml`) would satisfy the check:

```sh
gh attestation verify <binary> --repo attested-delivery/<repo> \
  --signer-workflow attested-delivery/<repo>/.github/workflows/release.yml \
  --predicate-type https://slsa.dev/provenance/v1
```

Expected output for both: `✓ Verification succeeded!`

## 3. Verify the keyless cosign signature (container images only)

```sh
cosign verify "ghcr.io/attested-delivery/<repo>@${DIGEST}" \
  --certificate-identity-regexp \
    '^https://github\.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Expected output: `Verification for ghcr.io/attested-delivery/<repo>@<digest> -- The cosign claims were validated` followed by a Rekor transparency log confirmation.

## 4. Verify the SBOM attestation

### Container images

```sh
cosign verify-attestation "ghcr.io/attested-delivery/<repo>@${DIGEST}" \
  --type cyclonedx \
  --certificate-identity-regexp \
    '^https://github\.com/attested-delivery/\.github/\.github/workflows/sign-and-attest\.yml@.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Binaries and bundles

```sh
gh attestation verify <binary> --repo attested-delivery/<repo> \
  --predicate-type https://cyclonedx.org/bom
```

If you want to also verify the vulnerability report attestation on a container image, use `cosign verify-attestation` with `--type "https://in-toto.io/attestation/vulns/v0.1"`. Do not use `--type vuln` — that alias maps to cosign's own predicate URI and will not match.

## 5. Verify quality-gate attestations (seam-signed)

Gate verdicts (SAST, SCA, IaC/license, container scan, supply-chain posture, DAST) are all signed by the single central seam workflow `reusable-attest-scan.yml`. Pin that signer once and swap only `--predicate-type` per gate.

```sh
SUBJECT="oci://ghcr.io/attested-delivery/<repo>@${DIGEST}"
SEAM="attested-delivery/.github/.github/workflows/reusable-attest-scan.yml"

# SAST — swap predicate-type for other seam-signed gates:
# sca/v1, iac-policy/v1, iac-license/v1, dast/v1
gh attestation verify "$SUBJECT" \
  --owner attested-delivery \
  --signer-workflow "$SEAM" \
  --predicate-type https://attested-delivery.github.io/attestations/sast/v1
```

**One signer per command.** OpenVEX and k6 are self-signed by their own workflows; they require a separate invocation:

```sh
# OpenVEX disposition
gh attestation verify "$SUBJECT" \
  --owner attested-delivery \
  --signer-workflow attested-delivery/.github/.github/workflows/reusable-vex.yml \
  --predicate-type https://openvex.dev/ns/v0.2.0
```

The complete list of predicate URIs is in [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/).

## 6. Verify the plugin catalog blob signature (if applicable)

The `marketplace.json` plugin catalog is a plain blob signed with cosign keyless signing via `reusable-cosign-sign.yml`. Download the catalog and its `.cosign.bundle` file, then:

```sh
cosign verify-blob marketplace.json \
  --bundle marketplace.json.cosign.bundle \
  --certificate-identity-regexp \
    '^https://github\.com/attested-delivery/\.github/\.github/workflows/reusable-cosign-sign\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## 7. Verify the release checksum (binaries and bundles)

```sh
shasum -a 256 -c <bin>-<version>-checksums.txt
```

## Verification

Each `gh attestation verify` command exits 0 and prints `✓ Verification succeeded!` on success. `cosign verify` and `cosign verify-attestation` print `Verification for ... — The cosign claims were validated` and a Rekor transparency log entry.

**Check exit codes, not grepped output.** A filtered pipe that matches nothing looks identical to success. Silence is not success.

As a negative-path spot-check, run the same verify commands against an unrelated public digest with these flags and confirm they fail. This validates that your verification is actually constraining the signer identity and not silently vacuous.

## Troubleshooting

**`gh attestation verify` returns "no attestations found".** The release may not have completed the sign/attest jobs, or the digest you resolved does not match the one used during signing. Confirm the digest by inspecting the release workflow run in the Actions tab.

**`gh attestation verify` fails with a signer mismatch.** For container images, you may have omitted `--signer-workflow` or pointed it at the wrong workflow. Under SLSA L3 the cert SAN is the signer workflow, not the source repo — `--repo` alone is insufficient. For binary/bundle attestations, pin `--signer-workflow` to the repo's release workflow — `--repo` alone is less specific and can be satisfied by any provenance producer in the repo.

**`cosign verify` fails with a certificate identity mismatch.** The regexp must escape the `.` characters in the workflow path. Confirm the regexp exactly matches the path `attested-delivery/.github/.github/workflows/sign-and-attest.yml`. Backslash-escape `.` as `\.`.

**To inspect the raw certificate when verification surprises you:**

```sh
gh api repos/attested-delivery/<repo>/attestations/${DIGEST} \
  --jq '.attestations[0].bundle.verificationMaterial.certificate.rawBytes' \
  | base64 -d | openssl x509 -inform DER -noout -text \
  | grep -A1 -E '1.3.6.1.4.1.57264.1.(5|6|12)|Subject Alternative'
# SAN = signer workflow @ pin; .12 = source repository; .6 = source ref
```

## Related

- [Reference: Signing and Verification Workflows](/docs/reference/signing-and-verification-workflows/)
- [Reference: Quality-Gate Workflows](/docs/reference/quality-gate-workflows/)
- [Concept: Attestations That Survive Promotion](/docs/concepts/03-attestations-that-survive-promotion)
- [Concept: SLSA L3 Is Nearly Free](/docs/concepts/05-slsa-l3-is-nearly-free)
- [Concept: An SBOM You Can Actually Use](/docs/concepts/06-an-sbom-you-can-actually-use)
- [How to Wire Attested Quality Gates into a Repository](/docs/guides/onboard-a-repo)
- [How to Promote a Build](/docs/guides/promote-a-build)
