---
title: "Verify Your First Attested Release"
description: "Download a published release from the attested-delivery org and verify its SLSA provenance and CycloneDX SBOM from a clean workstation in under five minutes."
diataxis_type: tutorial
diataxis_learning_goals:
  - "Verify SLSA provenance and a CycloneDX SBOM for a published release"
---

By the end of this tutorial we will have downloaded a real published release artifact, verified its SLSA Build Level 3 provenance, and verified its CycloneDX SBOM — all from the command line, with no credentials beyond a public GitHub token. We will do this against the `rust-template` `v0.1.0` release in the `attested-delivery` org, which is publicly available and known-good.

**What we are proving:** the artifact we download is byte-identical to what CI built, signed it with an ephemeral OIDC key, and the SBOM that describes it is cryptographically bound to the same digest. Neither claim can be forged after the fact.

---

## Before we start

We need one tool: the [GitHub CLI](https://cli.github.com/) (`gh`), version 2.49 or later (the `attestation` subcommand was introduced in 2.49).

Check what we have:

```bash
gh --version
```

The output should look like:

```
gh version 2.xx.x (...)
```

If `gh` is not installed, follow the [official install instructions](https://cli.github.com/) for your platform, then authenticate:

```bash
gh auth login
```

Choose "GitHub.com" and "HTTPS" when prompted. We only need read access to public repos.

---

## Step 1 — Download the release artifact

We will download the Linux AMD64 binary from `rust-template` `v0.1.0`:

```bash
gh release download v0.1.0 \
  --repo attested-delivery/rust-template \
  --pattern 'rust-template-0.1.0-linux-amd64'
```

The output should look like:

```
✓ Downloaded rust-template-0.1.0-linux-amd64
```

Confirm the file is present:

```bash
ls -lh rust-template-0.1.0-linux-amd64
```

We should see a file of a few megabytes. If the download command lists no matching assets, the release asset name may differ — run `gh release view v0.1.0 --repo attested-delivery/rust-template` to see what is available.

---

## Step 2 — Verify the SLSA provenance attestation

Now we ask GitHub to retrieve the attestation bundle for this artifact and verify it against the org's published Sigstore transparency log entry:

```bash
gh attestation verify rust-template-0.1.0-linux-amd64 \
  --repo attested-delivery/rust-template
```

The output should look like:

```
Loaded digest sha256:<hex> for file://rust-template-0.1.0-linux-amd64

The following checks passed for all 1 attestation(s):

  ✓ Verification succeeded!
  - Predicate type:    https://slsa.dev/provenance/v1
  - Source repository: https://github.com/attested-delivery/rust-template
  - Build trigger:     push
  - Runner environment: github-hosted
```

What we have just confirmed:

- The artifact's SHA-256 digest matches the one recorded in the provenance statement.
- The provenance was signed by the GitHub Actions OIDC identity for `attested-delivery/rust-template` — not by a long-lived key we have to rotate.
- The signature is anchored in the Sigstore Rekor public transparency log, which means tampering with the record is detectable.

---

## Step 3 — Verify the CycloneDX SBOM attestation

The same artifact also carries an attached SBOM. We verify it with a different `--predicate-type`:

```bash
gh attestation verify rust-template-0.1.0-linux-amd64 \
  --repo attested-delivery/rust-template \
  --predicate-type https://cyclonedx.org/bom
```

The output should look like:

```
Loaded digest sha256:<hex> for file://rust-template-0.1.0-linux-amd64

The following checks passed for all 1 attestation(s):

  ✓ Verification succeeded!
  - Predicate type:    https://cyclonedx.org/bom
  - Source repository: https://github.com/attested-delivery/rust-template
```

The same digest, a different predicate type, a different attestation bundle — both verified. The SBOM is not just a document sitting next to the release; it is cryptographically bound to this exact artifact.

---

## What you've accomplished

We downloaded a real published artifact and independently verified — from a clean workstation, with no special access — that:

1. Its SLSA Build Level 3 provenance is valid and was produced by the `attested-delivery/rust-template` Actions workflow.
2. Its CycloneDX SBOM is valid and is bound to the same artifact digest.

Neither check required trusting a green checkmark in a CI tab. The evidence is in the Sigstore transparency log, verifiable by anyone.

---

## Next steps

- **Go deeper on verification:** [Verify a release](/docs/guides/verify-a-release/) covers advanced options — pinning the signer workflow, verifying container images by digest, and scripting verification into a deploy gate.
- **Understand why this works:** [Attestations that survive promotion](/docs/concepts/03-attestations-that-survive-promotion/) explains how attestations attach to artifacts as OCI referrers and why promoting by digest preserves the full evidence chain.
