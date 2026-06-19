# Security

This docs site is itself an **attested use case** of the attested-delivery
posture: the same supply-chain rigor the org preaches is applied to the site you
are reading. The CI pipeline is fail-closed — an artifact that cannot be verified
does not deploy.

## What the pipeline guarantees

- **SHA-pinned actions, enforced.** Every `uses:` is pinned to a full 40-char
  commit SHA. The central `attested-delivery/.github` **`pin-check`** reusable
  runs on the deploy workflow and fails closed on any tag/branch ref.
- **Attested deploy** (`.github/workflows/deploy.yml`): the published Pages
  artifact carries a **SLSA build provenance** attestation and a **CycloneDX
  SBOM** attestation, both keyless (Sigstore, via the run's OIDC `id-token`) and
  bound to the artifact's `sha256` digest. A dedicated `verify` job re-checks
  both **before** the deploy job is allowed to run.

This is a static-file artifact (not a container image), so the SLSA backbone is
`actions/attest-build-provenance` and the fail-closed verify runs
`gh attestation verify` inline on the artifact file — the central
`reusable-verify-gates.yml` verifies `oci://` subjects by digest, not a
caller-local file. There are no seam-signed gate verdicts here; the site ships
the **standard family only** (provenance + SBOM).

## Verify it yourself

You do not need this repo's permissions or secrets to check its work. From any
workstation with the [GitHub CLI](https://cli.github.com/) authenticated:

```bash
# 1 · grab the exact artifact CI published (the Pages tarball)
RUN_ID=$(gh run list --repo attested-delivery/docs \
  --workflow "Deploy docs to GitHub Pages" --status success \
  --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$RUN_ID" --repo attested-delivery/docs \
  --name github-pages --dir ./_verify

# 2 · verify SLSA build provenance (bound to the artifact digest)
gh attestation verify ./_verify/artifact.tar \
  --repo attested-delivery/docs \
  --signer-workflow attested-delivery/docs/.github/workflows/deploy.yml \
  --predicate-type https://slsa.dev/provenance/v1

# 3 · verify the CycloneDX SBOM attestation
gh attestation verify ./_verify/artifact.tar \
  --repo attested-delivery/docs \
  --signer-workflow attested-delivery/docs/.github/workflows/deploy.yml \
  --predicate-type https://cyclonedx.org/bom
```

Each command exits non-zero on any failure. `--repo` pins where the build ran;
`--signer-workflow` pins **which** workflow produced the attestation (the deploy
workflow), which matters because this repo has more than one provenance-producing
workflow (`deploy.yml` and `dast.yml`). Inspect the predicate body to read the
recorded claim:

```bash
gh attestation verify ./_verify/artifact.tar \
  --repo attested-delivery/docs \
  --signer-workflow attested-delivery/docs/.github/workflows/deploy.yml \
  --predicate-type https://cyclonedx.org/bom --format json \
  | jq '.[0].verificationResult.statement.predicate | keys'
```

A successful verification proves the attestation is authentic and bound to the
artifact. A signed attestation records that a gate **ran and produced a
verdict** — read the predicate body for the verdict itself.

## Reporting a vulnerability

Open a private security advisory via the **Security → Advisories** tab on the
repository, or start a thread in the org's
[discussions](https://github.com/orgs/attested-delivery/discussions). Please do
not file public issues for undisclosed vulnerabilities.
