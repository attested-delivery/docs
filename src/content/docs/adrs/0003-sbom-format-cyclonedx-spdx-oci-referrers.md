---
title: "ADR 0003: SBOM Format — CycloneDX 1.6 Primary + SPDX 2.3/3.0 Export via OCI Referrers"
description: "Selects CycloneDX 1.6 as primary SBOM format with SPDX 2.3 as secondary, stored as OCI referrers using the cosign SBOM attestation type."
diataxis_type: explanation
---

Status: Accepted
Date: 2026-06-01

## Context

An SDLC that mandates SBOM generation for all container images and Helm charts without specifying the format or attachment mechanism leaves format negotiation to individual teams and breaks downstream tooling interoperability (f_supply_chain_security_sbom_1). Two formats dominate the ecosystem: **SPDX** (ISO/IEC 5962:2021) and **CycloneDX**; and the SBOM must also **survive promotion** to be useful at admission time.

Generating an SBOM file without attaching it to the image digest via OCI referrers decouples the SBOM from the artifact it describes and makes admission-time verification mechanically impossible (f_supply_chain_security_sbom_18). This decision depends on ADR 0001 (attestation-preserving promotion): once referrers travel with the digest, an SBOM attached as a referrer travels automatically.

### Format evaluation

- **SPDX 3.0.1** (released April 2024): the ISO standard, mandated in some US government procurement contexts; tooling adoption is still fragmented — most tools generate SPDX 2.3 rather than 3.0, and SPDX's relationship model is stronger for license compliance (f_supply_chain_security_sbom_3).
- **CycloneDX 1.6**: best-fit for vulnerability workflows — native VEX (Vulnerability Exploitability eXchange) support, CDXA attestations extension, CBOM (cryptography bill of materials); broadly supported by Grype, Dependency-Track, and the Anchore stack (f_supply_chain_security_sbom_4).

**Regulatory requirements:** NTIA 2021 defines seven minimum SBOM elements (supplier, component name, version, identifiers, dependencies, author, timestamp). CISA 2025 draft extends these with mandatory component hash, SPDX license expression, tool name, and generation context — fields that must be explicitly mapped in the SBOM generation workflow (f_supply_chain_security_sbom_5). EO 14028 + EO 14144/14306 (AI and post-quantum) establish the federal SBOM mandate baseline (f_supply_chain_security_sbom_6).

## Decision

Adopt **CycloneDX 1.6 as the primary SBOM format** for all container images and Helm charts.

Additionally, generate a **SPDX 2.3/3.0 export** for procurement and regulatory contexts that require the ISO format.

Attach the SBOM to the **image digest via OCI referrers** using `cosign attest --predicate <sbom.cdx.json> --type cyclonedx` (or the Syft-native `syft attest`) so the SBOM co-locates with the digest in the registry and survives promotion once ADR 0001 is in effect.

Map CISA 2025 extended fields into the CycloneDX 1.6 `metadata.tools`, `metadata.authors`, `components[].hashes`, and `components[].licenses` fields at generation time. Validate completeness with `cyclonedx-cli validate --input-format json`.

Tooling: **Syft** (post-Trivy; see ADR 0008) generates CycloneDX 1.6 and SPDX 2.3 natively from container images and source trees without requiring a running container.

## Implementation Details

- Add a `generate-sbom` step to the build workflow using `syft <image>@<digest> -o cyclonedx-json=sbom.cdx.json -o spdx-json=sbom.spdx.json`.
- Attach the CycloneDX SBOM as an OCI referrer: `cosign attest --predicate sbom.cdx.json --type cyclonedx <image>@<digest>`.
- Store the SPDX export as a build artifact and attach to GitHub Release for procurement download.
- Add `cyclonedx-cli validate` to the post-build quality gate; fail the build on invalid SBOM.
- Include SBOM referrer digest in the CCAB issue YAML payload for audit traceability.
- Set a re-attestation schedule for promoted digests: re-run Grype against the SBOM for new CVEs at ≤7-day cadence; re-attest on material findings.

## Alternatives Considered

- **SPDX only.** Rejected: SPDX 3.0 tooling adoption is fragmented (f_supply_chain_security_sbom_3); CycloneDX's VEX and CDXA extensions are better-fit for the vulnerability workflow and admission-time verification.
- **No format declaration (status quo).** Rejected: leaves format to team discretion; breaks Grype integration, Dependency-Track ingestion, and Kyverno/Ratify SBOM policy verification.
- **SPDX primary + CycloneDX export.** Rejected: CycloneDX's native VEX workflow and Grype integration make it the better primary; SPDX export satisfies procurement requirements.
- **Store SBOM out-of-band (S3).** Rejected: decouples SBOM from the digest it describes; breaks `cosign verify-attestation --type cyclonedx` at admission; out-of-band stores require separate access control and lifecycle management.

## Consequences

### Positive

- SBOM co-locates with the digest in ECR; admission-time SBOM verification becomes mechanically possible via ADR 0004.
- CycloneDX 1.6 VEX fields enable VEX-aware vulnerability triage to distinguish known-unexploitable from true positives.
- CISA 2025 and NTIA 2021 minimum element compliance satisfied at generation time.
- Dual-format output (CycloneDX + SPDX) satisfies both OSS-ecosystem and procurement/procurement/federal requirements without dual tool chains.

### Risks / Negative

- SBOM referrer size increases OCI manifest count per digest; ECR lifecycle policies must account for referrer pruning.
- SPDX 3.0 export is immature in Syft as of early 2026; use SPDX 2.3 until Syft 1.x stabilizes 3.0 support.
- Re-attestation schedule for promoted digests is an operational burden not currently in the promotion runbook.

## Relationships

- **Depends on:** ADR 0001 (attestation-preserving promotion — SBOM referrer must travel on copy), ADR 0002 (SLSA L3 context — SBOM is one of the referrers alongside SLSA provenance).
- **Depended on by:** ADR 0004 (admission policy may optionally verify SBOM referrer presence), ADR 0008 (Syft as SBOM generator — pinned by digest).
- **Related:** ADR 0006 (issue-driven promotion YAML payload carries SBOM digest for audit traceability).

## Well-Architected Alignment

Security, Operational Excellence
