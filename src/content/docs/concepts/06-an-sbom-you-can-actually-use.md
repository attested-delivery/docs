---
title: "An SBOM You Can Actually Use"
description: "Pick a real SBOM format, attach it to the image digest, and keep producing one even though the federal mandate is gone."
---

A vulnerability advisory lands for a transitive dependency you have never heard of. Someone asks the only question that matters: are we running it, and where? If your answer is "let me rebuild every image and rescan," you have already lost the afternoon. A software bill of materials exists to make that question answerable in seconds instead of hours. Most SBOMs fail at this because they are generated against a moving tag, stored in a wiki, and never looked at again.

A useful SBOM has three properties. It is in a format your tools actually read. It is bound to the exact artifact that ran, not to a tag that has since moved. And it is re-scannable without a rebuild. Get those right and the SBOM stops being a compliance checkbox and becomes an incident-response asset.

## Declare a format and mean it

There are two formats worth considering, and you should pick one as your house standard rather than emitting both and hoping consumers cope.

CycloneDX v1.7 is the current release, announced by the OWASP Foundation on 21 October 2025, superseding 1.6. The 1.7 release expands the cryptography bill of materials with standardized algorithm families and elliptic-curve listings aimed at post-quantum readiness, adds Data Provenance "Citations" for declaring where information came from and who is responsible for it, and introduces first-class support for patents and patent families ([cyclonedx.org](https://cyclonedx.org/news/cyclonedx-v1.7-released/)).

SPDX is the other option. SPDX 3.0 is the current version, with 3.0.1 as the latest point release, and it is an international open standard — ISO/IEC 5962:2021. SPDX 2.3 remains listed as a previous version and is still the pragmatic choice for a lot of tooling, since 3.0 adoption across scanners is uneven ([spdx.dev](https://spdx.dev/use/specifications/)).

The choice is less important than the commitment. CycloneDX leans toward security and dependency analysis; SPDX leans toward licensing and is the one to reach for when you need an ISO-standard artifact. Whatever you pick, write it down as the format your pipeline emits and your gates verify. An SBOM nobody can parse is worse than none, because it looks like coverage.

If you are reporting against a minimum-elements baseline, the NTIA 2021 "Minimum Elements for an SBOM" defines seven fields: supplier name, component name, version, other unique identifiers, dependency relationship, author of the SBOM data, and a timestamp. The Linux Foundation's SPDX HOWTO maps each of these directly to an SPDX 2.3 field ([SPDX NTIA HOWTO](https://spdx.github.io/spdx-ntia-sbom-howto/)). CISA published a 2025 draft update to those minimum elements for public comment, with the comment period closing 3 October 2025; it is a draft, not finalized guidance, so treat any new fields it proposes as a direction of travel rather than a requirement ([CISA](https://www.cisa.gov/resources-tools/resources/2025-minimum-elements-software-bill-materials-sbom)).

## Generate against the digest, not the tag

The most common mistake is scanning `myservice:latest`. A tag is a mutable pointer. Between the moment you scan it and the moment you deploy, it can be re-pointed at a different image, and your SBOM now describes something that is not running.

Generate against the content digest instead. Syft is "a CLI tool and Go library for generating a Software Bill of Materials (SBOM) from container images and filesystems" and selects its output format with `-o` ([anchore/syft](https://github.com/anchore/syft)). Resolve the digest first, then scan the immutable reference:

```sh
IMAGE=ghcr.io/your-org/your-repo/my-service
DIGEST=$(crane digest "$IMAGE:latest")   # sha256:...
syft "$IMAGE@$DIGEST" -o cyclonedx-json=./sbom.cdx.json
```

Confirm the emitted `specVersion` is `1.7`. If your Syft build defaults to an older CycloneDX schema, pin it with the format suffix: `-o cyclonedx-json@1.7=./sbom.cdx.json`.

## Attach it to the artifact as a referrer

A file in a build-artifacts bucket is not attached to anything. The way to bind an SBOM to an image so it travels with the artifact is the OCI referrers mechanism: a separate manifest whose `subject` field points at the target image digest, discoverable through the registry's referrers API ([OCI distribution-spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)).

In CI, `actions/attest` does this for you. It exposes a purpose-built `sbom-path` input — "Path to the JSON-formatted SBOM file (SPDX or CycloneDX) to attest" — and selects the correct predicate type based on the file you hand it ([actions/attest](https://github.com/actions/attest)):

```yaml
- name: Attest SBOM
  uses: actions/attest@v4
  with:
    subject-name: ghcr.io/${{ github.repository }}/my-service
    subject-digest: ${{ steps.push.outputs.digest }}
    sbom-path: ./sbom.cdx.json
    push-to-registry: true
```

Outside CI the equivalent is `cosign attest` against the digest with `--type cyclonedx --predicate ./sbom.cdx.json`. Either way, list the referrers afterward to confirm the SBOM actually arrived:

```sh
oras discover "$IMAGE@$DIGEST"
```

One caution that bites people during promotion: because referrers are separate manifests rather than image layers, a naive image-only copy by digest moves the image and leaves the SBOM behind. Whatever copies images between registries has to be referrer-aware, or the SBOM you carefully attached evaporates at the first promotion.

## Re-scan without rebuilding

The point of binding the SBOM to a digest is that you can answer the advisory question later without touching the build. Grype scans images, filesystems, and SBOMs directly, and the SBOM-first pattern is the one that pays off: generate once with Syft, then re-scan the stored SBOM as the vulnerability database updates ([anchore/grype](https://github.com/anchore/grype)).

```sh
grype sbom:./sbom.cdx.json
```

That command runs in seconds against an SBOM you produced weeks ago, with no registry pull and no rebuild. When the next advisory lands, you query your stored SBOMs and get a list of affected digests immediately. That is the entire payoff — and it only works if the SBOM was bound to a real, immutable identity in the first place.

One note on tool choice: Grype and Trivy are not drop-in equivalents. They use different vulnerability databases and matching logic, and the same image can produce materially different findings between them — and even the same scanner can disagree with itself depending on which tool generated the SBOM it is reading. Pin your scanner version and your SBOM generator together so results stay reproducible, and treat the choice of scanner as a real engineering decision rather than an implementation detail.

## Why bother, now that nobody is forcing you

For a few years, the case for SBOMs leaned on federal pressure. That scaffolding is gone. Executive Order 14306, signed 6 June 2025, amended the prior cybersecurity order and struck its centralized secure-software-development directives ([whitehouse.gov](https://www.whitehouse.gov/presidential-actions/2025/06/sustaining-select-efforts-to-strengthen-the-nations-cybersecurity-and-amending-executive-order-13694-and-executive-order-14144/)). A subsequent OMB memorandum in January 2026 made secure-development attestations and SBOM provision agency-discretionary and risk-based rather than mandatory. If your SBOM program was justified by "the government requires it," that justification has evaporated.

It should not have been your reason anyway. The reason to produce an SBOM is the advisory at the top of this post: you want to answer "are we running it, and where" in seconds. Customers in contract negotiations increasingly expect one. And the operational machinery — generate against the digest, attach as a referrer, re-scan without rebuild — pays for itself the first time a critical CVE lands in a dependency three levels down from anything you wrote. Produce the SBOM because it makes you faster during an incident, not because a memo told you to. The memo is gone; the incidents are not.
