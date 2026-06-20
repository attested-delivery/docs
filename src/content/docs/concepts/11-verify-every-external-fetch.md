---
title: "Verify Every External Fetch"
description: "A build is only as trustworthy as what enters it. Every workflow step that downloads or installs a package, binary, or tool must pin an exact version, verify integrity, and fail closed on mismatch — with a preference ladder that prefers the runner first."
---

The organization's promise is that *the thing you verified is the thing that runs*. That promise is worth nothing if the build itself was assembled from untrusted bytes. Every step that pulls something external into a job — a release tarball, a `go install`, a `curl … | sh` bootstrap, an unpinned `cargo install` — is a supply-chain entry point. If any one of them can be silently swapped, an attacker does not need to break your signing: they poison the input *before* you sign it, and your attestation faithfully certifies the compromised result.

This is the same class of attack as the [March 2026 `trivy-action` compromise](/docs/concepts/07-supply-chain-hazards-2026/) — a mutable reference repointed at malicious code that ran inside other people's builds. A tarball fetched by version *tag*, an install script piped into a shell, or a tool resolved to "latest" carries the same mutability risk as an unpinned action. So the rule generalizes beyond `uses:` pinning: **every step that downloads or installs anything must pin an exact version, verify integrity, and fail closed on mismatch.**

## Pinning a version is not verifying you got it

Pinning answers *which* artifact you wanted; it does not prove you *got* that artifact. A registry can be compromised, a mirror poisoned, a download intercepted. The two requirements are independent and both mandatory:

- **Pin the version** → eliminates "latest"/floating drift; makes the build reproducible and the intended artifact explicit.
- **Verify integrity** → eliminates substitution; proves the pinned bytes are the real bytes.

## Fail closed, never fail open

A verification step that logs a warning and continues is theater. The entire value of the check is that a mismatch *stops the build*. Under `set -euo pipefail`, a failed `sha256sum -c` aborts the job; an `… || true` appended to an install, or a verify whose exit code is ignored, converts a hard boundary into a decorative one. The same logic forbids `curl … | sh`: piping bytes straight into an interpreter executes them *before* any check can run — there is no point at which a mismatch could halt anything.

## Prefer the runner first

The cheapest fetch to secure is the one you never make. GitHub-hosted runners ship a large, known, GitHub-maintained toolset, and the runner image *is* a trust root: built, versioned, and published by the same platform that runs the job. Using a preinstalled tool directly removes an entire download-and-verify step and shrinks the attack surface to nothing. Only when a tool is genuinely absent does the ladder begin.

## The preference ladder

Stop at the first option that applies.

| Order | Option | Integrity boundary |
|---|---|---|
| 1 | Use a tool **preinstalled on the runner** | The runner image (GitHub-maintained) |
| 2 | Use a **SHA-pinned action** | The full 40-char commit SHA (`pin-check` enforced) |
| 3 | **Download → verify → fail closed** | The integrity ladder below (never below a checksum) |
| 4 | **Package-manager install**, pinned | Lockfile / registry checksum database |

When option 3 applies, use the **strongest mechanism the artifact actually supports** — with a hard floor of a pinned-digest checksum. Rather than block adoption on the strongest mechanism, use what each artifact supports and leave a `# TODO` to upgrade the floor as publishers ship signed provenance.

| Rank | Mechanism | Command |
|---|---|---|
| 1 (strongest) | Sigstore attestation | `gh attestation verify <file> --owner <o> --signer-workflow <wf>` |
| 2 | Detached signature | `cosign verify-blob` / `gpg --verify` / `minisign -V` |
| 3 (floor) | Pinned-digest checksum | `echo "<sha256>  <file>" \| sha256sum -c -` |

For every option-3 fetch: run under `set -euo pipefail`; resolve the digest/SHA **at use time** from the publisher's release, never from memory; download to a file and verify **before** executing; never pipe-to-shell.

```bash
set -euo pipefail
VERSION="1.7.7"
SHA256="<sha256 of the pinned release artifact, from its published checksums>"
curl -sSfL -o tool.tar.gz "https://…/v${VERSION}/tool_${VERSION}_linux_amd64.tar.gz"
echo "${SHA256}  tool.tar.gz" | sha256sum -c -   # aborts the job on mismatch
tar xzf tool.tar.gz -C /usr/local/bin tool
```

## Package-manager installs use lockfile / registry integrity

Pin the version and let the package manager's own integrity machinery fail closed. Never unpinned, never failure-swallowing (`… || true`).

| Ecosystem | Required form | Integrity source |
|---|---|---|
| npm | `npm ci` | `package-lock.json` hashes |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm-lock.yaml` hashes |
| yarn | `yarn --immutable` | `yarn.lock` hashes |
| Go | `go install <pkg>@<version>` | Go checksum database |
| Rust | `cargo install --locked --version <X> <crate>` | crates.io index checksums |
| Node package managers | `corepack enable` | Signed package-manager keys |

## Centralize the verified fetch

The practice applies to *every* workflow, not just the release pipeline — a linter in CI, a benchmark tool in a nightly job, and a doc generator in a Pages deploy each run with the repository's credentials and can taint anything downstream. When more than one workflow needs the same option-3 fetch, do not copy the block: lift it into a central reusable workflow and consume it as a thin caller. The org does exactly this for `actionlint` — the verified fetch lives once in `attested-delivery/.github`'s `reusable-actionlint.yml`, and callers consume it pinned by SHA — and prefers a SHA-pinned action (`anchore/sbom-action`) over a hand-rolled Syft download wherever one exists.

## Verifying which tools the runner already ships

The authoritative, version-exact list is the [`actions/runner-images`](https://github.com/actions/runner-images) image readme for your runner (for `ubuntu-latest`, the Ubuntu 24.04 readme). Confirm at use time with `which <tool>` in a scratch step rather than trusting a remembered list. Commonly present: `bash`, `curl`, `wget`, `tar`, `gh`, `git`, `git-lfs`, `jq`, `node`, `npm`, `python3`, `go`, `cargo`, `java`, `docker`, `docker compose`, `podman`, `skopeo`, `aws`, `az`, `gcloud`, `make`, `cmake`, `gcc`, `clang`. Commonly **absent** (need option 2 or 3): `actionlint`, `cosign`, `syft`, `grype`, `trivy`, `cargo-criterion`, `cargo-deny`.
