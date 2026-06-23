---
title: "Interface Contracts"
description: "Formal interface contracts for the attested delivery pipeline components including registry APIs, attestation schemas, and admission webhook contracts."
diataxis_type: reference
---

This document is the authoritative, **recipient-independent** definition of the integration boundaries of the
attested-delivery architecture. Each boundary is a named **interface contract**: a producer or gate on one side
emits or checks evidence in a defined shape, and any implementation that satisfies the contract interoperates
with the rest of the architecture — regardless of language, CI system, registry, or organization.

A **recipient** (any service, pipeline, or platform that participates in attested delivery) is **defined by
which interfaces it conforms to**. Conformance is established by an **executable probe** run against a real
artifact — not by reading this corpus, and not by being documented here. This document names no recipient and
cites no internal research; it is grounded entirely in public primary sources (SLSA, in-toto, Sigstore, OCI,
OpenTelemetry, Open Data Contract Standard, OPA, AWS, GitHub).

## How to use this document

Each interface section has five parts:

- **Purpose** — the boundary it defines.
- **Contract** — the exact evidence shape: predicate types, required fields, commands, schemas. Primary-sourced.
- **Conformance** — a normative `MUST` checklist. An implementation that satisfies every `MUST` conforms.
- **Reference probe** — a path under [`conformance/`](conformance/README.md) to an executable check a recipient
  runs against an artifact (digest, package, log record) to get a pass/fail verdict.
- **Reference implementation / Primary sources** — a worked how-to (under `handbook/how-to/`) and the public
  specs the contract is grounded in.

Interfaces version independently. A contract change that removes or tightens a `MUST` is breaking and increments
the interface's major version (e.g. `I2 v2`). Adding an optional field is non-breaking.

## Interface index

| # | Interface | Boundary | Reference probe |
| --- | --- | --- | --- |
| I1 | Attestation-Production | a build emits signed SLSA provenance + in-toto statements for its output | `conformance/verify-attestation-production.sh` |
| I2 | Promotion-Verification | a promotion step verifies attestations before advancing an artifact | `conformance/verify-promotion.sh` |
| I3 | Release-Attestation | a release/publish step produces provenance per artifact class | `conformance/verify-release-attestation.sh` |
| I4 | Policy-Gate | an admission/pre-flight gate requires a verifiable attestation matching policy | `conformance/verify-policy-gate.sh` |
| I5 | Quality-Event | a quality/data signal is emitted as a versioned data contract event | `conformance/verify-quality-event.sh` |
| I6 | Log-Contract | a service emits logs carrying build-identity resource attributes | `conformance/verify-log-contract.sh` |
| I7 | Polyglot-Attestation | a non-OCI / language-native artifact carries signing + provenance | `conformance/verify-polyglot.sh` |
| I8 | DAST-Evidence | a dynamic security scan produces a verifiable attestation gating release | `conformance/verify-dast-evidence.sh` |

---

## I1 — Attestation-Production

### Purpose

Defines what a build step must emit so its output artifact is independently verifiable: signed provenance and,
where applicable, test-result evidence, attached to the artifact's canonical digest.

### Contract

- The artifact is identified by its **content digest** (e.g. `sha256:…`), never by a mutable tag.
- The build emits an in-toto **SLSA provenance** attestation whose `predicateType` is the literal string
  `https://slsa.dev/provenance/v1` (match on the literal string; do not dereference the URL).
- The attestation is a DSSE-wrapped in-toto Statement whose `subject` binds the predicate to the artifact digest.
- Provenance is signed via Sigstore (Fulcio-issued short-lived cert bound to an OIDC identity; logged in Rekor).
- Build-time custom metadata (e.g. AI-authorship mode) is carried only in `externalParameters` using
  vendor-namespaced field names (`<vendor>_<fieldname>`); it MUST NOT alter the meaning of any other field.
- Test evidence, when produced, uses the in-toto **test-result** predicate
  `https://in-toto.io/attestation/test-result/v0.1` (`result` ∈ `PASSED|WARNED|FAILED`).
- Targeting SLSA **Build L3** is a property of the build *platform* (run isolation + signing material kept out
  of user-controlled build steps), not of any specific workflow shape.

### Conformance — a conforming producer MUST

1. Emit a `https://slsa.dev/provenance/v1` attestation whose `subject` digest equals the artifact digest.
2. Sign the attestation through Sigstore (Fulcio + Rekor) or an equivalent transparency-logged signer.
3. Carry any custom build metadata only under `externalParameters` with `<vendor>_<field>` names.
4. NOT emit the superseded `https://slsa.dev/provenance/v0.2` predicate for new builds.
5. Make the attestation retrievable by the artifact's consumers (OCI referrer for images — see I2).

### Reference probe

`conformance/verify-attestation-production.sh <artifact-or-image@digest>` — asserts a `provenance/v1`
attestation exists for the digest and verifies its signature.

### Reference implementation / Primary sources

- How-to: `handbook/how-to/sign-keyless-with-cosign.md`, `handbook/runbooks/RB-09-slsa-l3-provenance.md`.
- <https://slsa.dev/spec/v1.1/levels> · <https://slsa.dev/provenance/v1> ·
  <https://slsa.dev/spec/v1.0/provenance> ·
  <https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md> ·
  <https://docs.sigstore.dev/cosign/signing/overview/>

---

## I2 — Promotion-Verification

### Purpose

Defines what a promotion step (moving an artifact between environments or registries) must check **before**
advancing it, so attestations produced by I1 are re-verified at every hop and never assumed.

### Contract

- Promotion is **by digest**. The promoter resolves the digest and verifies against it.
- Before advancing, the promoter verifies the artifact's SLSA provenance attestation, pinning the expected
  **predicate type** and **signer identity** (OIDC issuer + certificate identity / builder).
- For container images, promotion is **referrer-aware**: a naive image-only copy orphans attestations, which are
  separate manifests linked by `subject`. The promoter MUST copy the subject image *and* its signatures,
  attestations, and SBOMs (e.g. `cosign copy --only=sig,att,sbom <src> <dst>`), passing `--only` explicitly.
- Verification **fails closed**: a missing, deleted, or non-matching attestation MUST reject the promotion.

### Conformance — a conforming promoter MUST

1. Resolve and operate on the artifact **digest**, not a tag.
2. Run a verification that pins predicate type AND signer identity, e.g.
   `gh attestation verify <image@digest> --owner ORG --predicate-type https://slsa.dev/provenance/v1` or
   `cosign verify-attestation --type slsaprovenance …`.
3. Reject (non-zero exit, no advance) when the attestation is absent or does not match — fail closed.
4. For images, carry referrers across registry boundaries (referrer-aware copy), not a bare image copy.
5. Record the verification outcome as a signal (see I6 / observability), not only as a workflow log line.

### Reference probe

`conformance/verify-promotion.sh <image@digest> <expected-owner> <predicate-type>` — passes only if a matching,
signed attestation is present for the digest; non-zero otherwise (demonstrates fail-closed).

### Reference implementation / Primary sources

- How-to: `handbook/how-to/referrer-aware-promotion-and-verify.md`,
  `handbook/runbooks/RB-20-admission-verification.md`.
- <https://docs.sigstore.dev/cosign/verifying/attestation/> ·
  <https://github.com/opencontainers/distribution-spec/blob/main/spec.md> ·
  <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds>

---

## I3 — Release-Attestation

### Purpose

Defines what a release/publish step must produce so a *published* artifact (registry package, not just a
container image) carries provenance its consumers can verify. This is the publish-time analogue of I1.

### Contract

- Every release of a packaged artifact produces a provenance attestation bound to the artifact's digest/hash,
  using the **per-artifact-class mechanism** (see I7 for class-specific detail):
  container/OCI → `actions/attest-build-provenance` or `cosign attest`; Python → PEP 740 attestations via
  Trusted Publishing; npm → npm provenance (`--provenance`); non-OCI blobs/JARs/modules → `cosign sign-blob`
  / `gh attestation attest`.
- The release pipeline holds `id-token: write` (or equivalent OIDC) and actually exercises it to sign — granting
  the permission without producing an attestation does NOT conform.
- The attestation is published to where consumers fetch the artifact (registry referrer, PyPI attestation,
  npm registry, release asset).

### Conformance — a conforming release step MUST

1. Produce a provenance attestation for each released artifact, by its class mechanism.
2. Bind the attestation to the artifact's content hash/digest.
3. Publish the attestation alongside the artifact so a consumer can fetch and verify it.
4. NOT ship a release with `id-token`/signing capability present but unused.

### Reference probe

`conformance/verify-release-attestation.sh <artifact-ref>` — fetches the published artifact's attestation and
verifies it; non-zero if none is published.

### Reference implementation / Primary sources

- How-to: `handbook/how-to/attest-jvm-dotnet-terraform-artifacts.md` (I7 classes),
  `handbook/how-to/sign-keyless-with-cosign.md`.
- <https://docs.pypi.org/attestations/> · <https://docs.npmjs.com/generating-provenance-statements> ·
  <https://docs.github.com/en/actions/concepts/security/artifact-attestations>

---

## I4 — Policy-Gate

### Purpose

Defines the **engine-agnostic** admission/pre-flight contract: an artifact is admitted (to a cluster, an
environment, or a merge) only if it carries a verifiable attestation matching policy. Kyverno, Conftest/OPA, and
the Sigstore policy-controller are interchangeable *implementations* of this one contract.

### Contract

- The gate evaluates a **policy** against the artifact's attestations and metadata and returns admit/deny.
- The policy pins the required **predicate type** and the accepted **signer identity** (issuer + identity/builder).
- The gate is **deny-by-default**: an artifact with no matching, verifiable attestation is denied.
- The policy is **versioned and itself attestable** (policy-as-code in source control; distributed as a signed
  bundle or admission resource).
- The decision point may be CI-time (pre-flight: Conftest/OPA over config/SBOM/attestation JSON) or admission-time
  (Kubernetes: Kyverno `ImageValidatingPolicy`, Sigstore `ClusterImagePolicy`) — the contract is identical.

### Conformance — a conforming policy gate MUST

1. Deny by default when no matching attestation is present (fail closed).
2. Pin predicate type AND signer identity in the policy, not merely "an attestation exists".
3. Express the policy as version-controlled policy-as-code.
4. Apply the gate to the artifact **digest**, not a tag.
5. Emit an admit/deny decision signal (see I6).

### Reference probe

`conformance/verify-policy-gate.sh <image@digest> <policy-file>` — runs the policy and asserts deny on a
non-attested digest and admit on a conformant one.

### Reference implementation / Primary sources

- How-to: `handbook/how-to/author-kyverno-imagevalidatingpolicy.md`,
  `handbook/how-to/author-conftest-and-opa-policies.md`,
  `handbook/how-to/configure-sigstore-policy-controller.md`.
- <https://docs.sigstore.dev/policy-controller/overview/> · <https://www.conftest.dev/> ·
  <https://www.openpolicyagent.org/docs/latest/management-bundles/>

---

## I5 — Quality-Event

### Purpose

Defines the boundary between an attested SDLC and downstream **data-quality** consumers: a quality or pipeline
signal is published as a **versioned data-contract event**, so any consumer (metrics, dashboards, remediation,
lineage) can bind to a stable schema. This decouples producers and consumers — neither needs the other's code.

### Contract

- The event schema is declared with a versioned **data-contract specification** defining the event's fields,
  the publisher, the consumers, and SLA/servicelevels. Two distinct specs serve this role — do not conflate
  them: the **Data Contract Specification** (INNOQ, whose top-level field is `dataContractSpecification`;
  v1.2.x, now positioned as superseded by ODCS) and the **Open Data Contract Standard / ODCS** (Bitol / Linux
  Foundation, current v3.x, top-level `apiVersion`). A conforming producer MAY use either; the contract is the
  presence of a versioned, machine-readable schema, not a particular vendor's standard.
- A pipeline-completion event carries at minimum `pipeline`, `passed` (boolean), `pass_rate` (0.0–1.0), and
  `duration_seconds`, plus an envelope (`event_id`, `correlation_id`, ordering) for idempotent consumption.
- A `passed=true` pipeline-completion event is **attestation-adjacent**: it is machine-readable evidence that a
  quality gate ran and passed, analogous to an in-toto test-result link for a software build step.
- Schema changes are governed: removing a required field or narrowing a type is a **breaking change** that must
  fail a contract-compatibility CI check before publication (the data analogue of the I4 policy gate).

### Conformance — a conforming quality-event producer MUST

1. Declare the event schema as a versioned, machine-readable data-contract document (Data Contract Specification
   or ODCS) under source control.
2. Emit the required pipeline-completion fields (`pipeline`, `passed`, `pass_rate`, `duration_seconds`) + envelope.
3. Gate schema changes with a backward-compatibility check that fails the build on a breaking change.
4. Publish to the declared transport (e.g. an event bus) within the declared SLA.

### Reference probe

`conformance/verify-quality-event.sh <event.json> <contract.yaml>` — validates an event instance against its
ODCS contract and checks required fields are present.

### Reference implementation / Primary sources

- Architecture: `RESEARCH-REPORT.md` §23 (interface description); reference impl is any data-contract-governed
  event bus.
- <https://datacontract.com/> (Data Contract Specification, INNOQ) ·
  <https://github.com/bitol-io/open-data-contract-standard> (ODCS, Linux Foundation) ·
  <https://docs.aws.amazon.com/glue/latest/dg/dqdl.html> · <https://openlineage.io/docs/>

---

## I6 — Log-Contract

### Purpose

Defines the structured-logging boundary: every service emits log records carrying the **build-identity resource
attributes** that link runtime output back to the attested artifact that produced it, in a schema a shared
platform library and the collector can rely on.

### Contract

- Log records follow the **OpenTelemetry Log Data Model** `LogRecord` shape (Timestamp, SeverityNumber,
  SeverityText, Body, TraceId/SpanId, Resource, Attributes).
- The `Resource` carries `service.name`, `service.version`, `service.instance.id`, and `deployment.environment`
  — the process-identity attributes that bind each record to a specific build/version.
- `service.version` ties the log stream to a build; the source-commit revision
  (`org.opencontainers.image.revision`) and/or image digest tie it to the attested artifact from I1. Note these
  OCI manifest labels are **not** auto-read by the Collector's `k8sattributes` processor — surface them as a
  deploy-time pod annotation (which `k8sattributes` can copy) or stamp them with the OTTL `transform` processor.
- Attribute names follow OTel semantic conventions; the schema is testable in CI via an in-memory log exporter
  (a log-contract conformance test) so a schema regression fails before deploy.

### Conformance — a conforming log emitter MUST

1. Emit records matching the OTel `LogRecord` data model.
2. Populate `service.name`, `service.version`, and `deployment.environment` on every record's `Resource`.
3. Carry the artifact image digest / revision where the runtime exposes it.
4. Validate the log schema in CI (in-memory exporter assertions) so a breaking change fails the build.

### Reference probe

`conformance/verify-log-contract.sh <log-record.json>` — asserts the record carries the required resource
attributes and matches the LogRecord shape.

### Reference implementation / Primary sources

- Architecture: `RESEARCH-REPORT.md` §23 (logging interface).
- <https://opentelemetry.io/docs/specs/otel/logs/data-model/> ·
  <https://opentelemetry.io/docs/specs/semconv/general/logs/>

---

## I7 — Polyglot-Attestation

### Purpose

Defines the per-artifact-class signing + provenance contract for **non-OCI / language-native** artifacts, so a
.NET package, a JAR/WAR, a Python wheel, an npm package, a Helm chart, a Go binary, or a Terraform module each
carries verifiable provenance. This is the class-specific elaboration of I3.

### Contract

- Each released artifact of a given class carries a signature and, where the ecosystem supports it, a provenance
  attestation bound to the artifact's content hash:
  - **Python** → PEP 740 attestations via PyPI Trusted Publishing.
  - **npm** → npm provenance (`npm publish --provenance`).
  - **Helm** (OCI) / **container** → `cosign attest` / `actions/attest-build-provenance` as OCI referrers.
  - **Go** → module checksum DB + SLSA generator provenance.
  - **.NET / NuGet, Java JAR/WAR, Terraform modules** (no native SLSA-provenance channel) → sign + attest the
    artifact bytes with `cosign sign-blob` / `gh attestation attest`, in addition to any ecosystem-native
    signature (NuGet author/repo signing, `jarsigner`/Maven GPG, HashiCorp registry GPG).
- Verification uses the class-appropriate verifier (`cosign verify-blob`, `nuget verify`, `jarsigner -verify`,
  PyPI/npm attestation verification).

### Conformance — a conforming polyglot release MUST

1. Produce a signature for the artifact using its ecosystem-native mechanism where one exists.
2. Produce a provenance attestation (PEP 740 / npm provenance / `cosign sign-blob` / SLSA generator) bound to the
   artifact hash.
3. Publish both so a consumer can verify provenance without the build system.
4. Use the literal SLSA `provenance/v1` predicate type where SLSA provenance is emitted.

### Reference probe

`conformance/verify-polyglot.sh <artifact-path> <class>` — dispatches to the class verifier and asserts a valid
signature + attestation.

### Reference implementation / Primary sources

- How-to: `handbook/how-to/attest-jvm-dotnet-terraform-artifacts.md` (.NET / JVM / Terraform);
  `RESEARCH-REPORT.md` §20 (Python/npm/Helm/Go).
- <https://docs.pypi.org/attestations/> · <https://docs.npmjs.com/generating-provenance-statements> ·
  <https://docs.sigstore.dev/cosign/signing/other-artifact-types/>

---

## I8 — DAST-Evidence

### Purpose

Defines what a dynamic application security test (DAST) run must produce so its result becomes a verifiable
attestation that a CERT-stage release gate can check — turning "we ran a scan" into signed, gateable evidence.

### Contract

- The DAST run exports a machine-readable result (JSON/SARIF) for the scanned, deployed artifact at its digest.
- The result is wrapped as an in-toto attestation (a custom DAST predicate type, or the in-toto test-result
  predicate `https://in-toto.io/attestation/test-result/v0.1` with `result` ∈ `PASSED|WARNED|FAILED`) bound to
  the artifact digest, signed via Sigstore (`cosign attest --type <predicate-type> --predicate <result> <img@digest>`).
- The CERT gate verifies the DAST attestation exists and passes
  (`cosign verify-attestation --type <predicate-type> …`); a deploy lacking a passing DAST attestation **fails
  closed**.

### Conformance — a conforming DAST-evidence step MUST

1. Export the scan result in a machine-readable format bound to the artifact digest.
2. Sign it as an in-toto attestation with a declared predicate type.
3. Have the release gate verify the attestation and fail closed when it is absent or failing.

### Reference probe

`conformance/verify-dast-evidence.sh <image@digest> <predicate-type>` — asserts a passing DAST attestation is
present for the digest.

### Reference implementation / Primary sources

- How-to: `handbook/how-to/attest-dast-results.md`, `handbook/runbooks/RB-16-cert-validation-block.md`.
- <https://github.com/in-toto/attestation/blob/main/spec/predicates/test-result.md> ·
  <https://docs.sigstore.dev/cosign/verifying/attestation/> · <https://www.zaproxy.org/docs/>

---

## Recipient conformance

A recipient self-assesses by running each interface's probe against its real artifacts and recording the verdict
in a copy of [`conformance/conformance-matrix-template.md`](conformance/conformance-matrix-template.md). The
matrix is the recipient's own artifact; it is not part of this architecture. A recipient "implements the attested
SDLC" exactly to the extent its matrix shows `PASS` across the interfaces it participates in — defined entirely
by the probes above, independent of this corpus.
