---
title: "Recording AI Authorship in Provenance"
description: "Co-authored-by is the wrong trailer for AI. Use a dedicated Assisted-by trailer, carry it into SLSA externalParameters, and anchor autonomous builds with OIDC."
diataxis_type: explanation
---

A developer accepts a few AI completions, finishes the change by hand, and commits. The editor quietly adds `Co-authored-by: Copilot` to the message. The developer never typed that line, never reviewed it, and in some cases had AI features explicitly turned off. That is not a hypothetical. It is the kind of provenance you cannot trust, and it is the reason "just use co-authored-by" is the wrong answer for recording AI involvement.

If you want to know later which changes were AI-assisted — for the cohort analysis that makes your delivery metrics honest, for an audit, for a security review after the fact — you need that record to be a deliberate, durable fact. Two places matter: the commit, and the build provenance. Both have a conformant way to carry the metadata, and `Co-authored-by` is neither.

## Why Co-authored-by is the wrong field

`Co-authored-by` is a human-identity trailer. It asserts that a named person co-wrote the change and shares authorship credit. Pointing it at an AI tool overloads a field that means something specific, and worse, the tooling that populates it has demonstrably gotten it wrong.

VS Code 1.117 changed the AI co-author setting default to `all`, and the release history is candid: "There was a bug in the code that was not found in testing that attributed non-Copilot code completions to Copilot," emitting `Co-authored-by: Copilot` "even when the `disableAIfeatures` setting was turned on." The default was reverted to `off` in 1.118, with permanent fixes in 1.119 ([microsoft/vscode#314311](https://github.com/microsoft/vscode/issues/314311)).

Read that carefully. The trailer was added to commits where AI was disabled. Provenance was rewritten after the developer's last review, by a tool the developer was not watching. A field that can be silently mutated to say the opposite of the truth is not a provenance record — it is noise that looks like signal. And because it overloads a human-credit field, you cannot even cleanly distinguish "a person named Copilot co-authored this" from "a tool was involved."

## Use a dedicated trailer instead

Open-source projects that take this seriously have converged on a separate, purpose-built trailer. The Linux kernel prescribes `Assisted-by: AGENT_NAME:MODEL_VERSION` and is explicit on the line you must not cross: "AI agents MUST NOT add Signed-off-by tags. Only humans can legally certify the Developer Certificate of Origin (DCO)" ([kernel coding-assistants](https://docs.kernel.org/process/coding-assistants.html)). Fedora's policy uses a similar `Assisted-by:` trailer and holds that "The contributor is always the author and is fully accountable" ([Fedora AI-assisted policy](https://communityblog.fedoraproject.org/council-policy-proposal-policy-on-ai-assisted-contributions/)).

The shape of the convention matters. `Assisted-by` records that AI helped without claiming AI authored or certified anything. The human remains the author and the accountable party. The AI is disclosed, not credited.

Inject it at commit time with a `prepare-commit-msg` hook, which "is invoked by git-commit right after preparing the default log message, and before the editor is started" — the right injection point ([git githooks](https://git-scm.com/docs/githooks)):

```sh
#!/usr/bin/env bash
# .git/hooks/prepare-commit-msg
COMMIT_MSG_FILE="$1"
if [ -n "${AI_AGENT:-}" ]; then
  git interpret-trailers --in-place \
    --trailer "Assisted-by: ${AI_AGENT}" "$COMMIT_MSG_FILE"
fi
exit 0
```

One precision point that catches people writing tooling against these: git trailers "look similar to RFC 822 e-mail headers" but git explicitly disclaims following the RFC 822 rules ([git interpret-trailers](https://git-scm.com/docs/git-interpret-trailers)). They are RFC-822-*style*, not RFC-822-compliant. Do not assume full header semantics — folding, quoting, comment syntax — will parse the way an email library expects. Parse trailers with `git interpret-trailers`, not an email header parser.

## Carry it into build provenance, conformantly

The commit trailer is the authoring record. The build provenance is the artifact record, and SLSA has a defined, conformant place for vendor extensions: `externalParameters`, which holds "the parameters that are under external control, such as those set by a user or tenant of the build platform." Extension fields "SHOULD use names of the form `<vendor>_<fieldname>`" and "MUST NOT alter the meaning of any other field" ([SLSA provenance v1.0](https://slsa.dev/spec/v1.0/provenance)).

In the build job, extract the `Assisted-by` trailers from the commit range and assemble a predicate with a vendor-namespaced field:

```sh
AI_TRAILERS=$(git log --format='%(trailers:key=Assisted-by,valueonly)' \
  origin/main..HEAD | grep -v '^$' | jq -R . | jq -s -c .)

cat > predicate.json <<JSON
{
  "buildDefinition": {
    "buildType": "https://example.com/buildtypes/container/v1",
    "externalParameters": {
      "myorg_ai_authoring": {
        "assisted_by": ${AI_TRAILERS:-[]},
        "source_ref": "${GITHUB_SHA}"
      }
    }
  }
}
JSON
```

The `myorg_ai_authoring` key follows the `<vendor>_<fieldname>` form, so a consumer that does not recognize it ignores it and interprets the attestation identically to one without it. That is the conformance guarantee: you get to carry your extension without breaking anyone else's verifier.

## Anchor autonomous builds with OIDC

The trailer convention assumes a human is in the loop, accountable for the change. As more of the work is done by autonomous agents, the "who ran this build" question gets sharper, and you cannot answer it with a self-asserted string in a commit message. You answer it with the workflow's own identity.

Sign the predicate keyless, using the build job's OIDC identity rather than a stored key:

```yaml
- name: Attest build provenance with AI-authoring metadata
  uses: actions/attest@v4
  with:
    subject-name: ghcr.io/${{ github.repository }}/my-service
    subject-digest: ${{ steps.push.outputs.digest }}
    predicate-type: https://slsa.dev/provenance/v1
    predicate-path: ./predicate.json
    push-to-registry: true

permissions:
  id-token: write       # mint the OIDC token for the signing certificate
  attestations: write
  contents: read
```

`id-token: write` "gives the action the ability to mint the OIDC token necessary to request a Sigstore signing certificate" ([actions/attest](https://github.com/actions/attest)). Anchor the record to the workflow execution with OIDC token claims — `job_workflow_ref`, `repository`, `run_id`, and `sha` ([GitHub OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)). The signature ties the attestation to a specific workflow at a specific commit, which is an identity an attacker cannot forge by editing a commit message.

Verify the whole thing end to end — that the signature checks against the expected workflow identity and that your vendor field survived:

```sh
cosign verify-attestation ghcr.io/your-org/your-repo/my-service@sha256:DIGEST \
  --type slsaprovenance \
  --certificate-identity-regexp "https://github.com/your-org/your-repo/.github/workflows/.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  | jq -r '.payload' | base64 -d \
  | jq '.predicate.buildDefinition.externalParameters.myorg_ai_authoring'
```

The result is a record that says which commits in a build were AI-assisted, carried in a signed attestation tied to a real workflow identity, with the human author still on the hook for the change. That is provenance you can act on — and it is the opposite of a co-author line a tool slipped in while no one was looking.
