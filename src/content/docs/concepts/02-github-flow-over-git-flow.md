---
title: "GitHub Flow over Git-Flow, and What the Release Candidate Actually Is"
description: "For a continuously delivered single-version service, the branching model is GitHub Flow and the release candidate is an attested image digest, not a release branch. Git-flow still earns its keep — for a different problem."
diataxis_type: explanation
---

Pick a branching model and you have quietly decided where your release lives, what it is made of, and how it moves to production. Most arguments about git-flow versus GitHub Flow skip that part and fight about branch diagrams. The diagram matters less than one question: when you say "the release candidate," what concrete thing are you pointing at?

For a single-version service that ships continuously, my answer is GitHub Flow as the branching model, and an attested image digest as the release candidate. Here is the reasoning, including the part where git-flow is the right answer to a different question.

## The model in one paragraph

GitHub Flow is a lightweight, branch-based workflow. GitHub's own documentation describes it directly: "GitHub flow is a lightweight, branch-based workflow." You "Create a pull request to ask collaborators for feedback on your changes." Then, "Once your pull request is approved, merge your pull request. This will automatically merge your branch so that your changes appear on the default branch." Finally, "After you merge your pull request, delete your branch" ([GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)).

One long-lived branch, `main`. Every unit of work is a short-lived branch that exists only long enough to be reviewed and merged. No `develop`, no `release/*`, no `hotfix/*` to reconcile. Deploying from the default branch is the conventional practice that follows from this shape — the documentation describes the branch → pull request → merge lifecycle without prescribing a specific deploy trigger, so "deploy from `main`" is a convention layered on top, not a quoted mandate.

## Three candidates, two rejected

Three branching models commonly come up for a delivery pipeline. All three are worth considering. Two lose for this specific context.

### Git-flow — rejected for continuous delivery

Git-flow, introduced by Vincent Driessen in 2010, uses long-lived `develop` and `main` branches plus dedicated `feature/*`, `release/*`, and `hotfix/*` branches. It is a rich model built around the act of *cutting a release*: stage changes on a `release/*` branch, stabilize them there, then tag a version.

The strongest evidence against using it for continuous delivery comes from Driessen himself, and it is routinely misread. The note he added to the top of the original 2010 post is frequently called a "retraction." It is not. It is a note of reflection — a repositioning that steers continuous-delivery teams toward a simpler model while explicitly preserving git-flow for the cases it was built for.

He writes: "If your team is doing continuous delivery of software, I would suggest to adopt a much simpler workflow (like GitHub flow) instead of trying to shoehorn git-flow into your team." He continues: "If, however, you are building software that is explicitly versioned, or if you need to support multiple versions of your software in the wild, then git-flow may still be as good of a fit to your team as it has been to people in the last 10 years." And he closes: "always remember that panaceas don't exist. Consider your own context" ([nvie.com](https://nvie.com/posts/a-successful-git-branching-model/)).

Read that carefully. The author of git-flow is not abandoning it. He is pointing single-version, continuously delivered services *away* from it — and toward GitHub Flow by name. A continuously delivered web service is exactly the case he is steering elsewhere.

### Trunk-based development — close, not chosen

Trunk-based development collapses to a single shared branch with very short-lived or no feature branches. It is philosophically close to GitHub Flow, and for many teams the two are nearly indistinguishable in practice. The reason to name GitHub Flow specifically is mechanical: the short-lived-branch-plus-pull-request shape maps cleanly onto the review, required-status-check, and code-owner gates you will want to attach to every change. The pull request is a natural place to hang those gates. A pure trunk model with no pull request has to find somewhere else to put them.

### GitHub Flow — chosen

GitHub Flow keeps a single integration branch and treats every change as a reviewed pull request. It is simple enough that there is no branch topology to keep stable, and structured enough that review, required status checks, and code ownership attach naturally to the pull request. For a single-version service practicing continuous delivery, it is the model the tooling and the documentation already assume.

## The release candidate is not a branch

This is the consequence that actually changes how you work, and it is where the model diverges most sharply from git-flow.

In git-flow, the release candidate is a branch. `release/1.4.0` is a mutable place where stabilization happens — you cherry-pick fixes onto it, you let it settle, you tag it when it looks done. The candidate is a location in your repository that things are still being done *to*.

GitHub Flow has no such branch. So the question sharpens: if there is no `release/*`, what is the candidate that gets promoted toward production?

The answer is the build artifact identified by its content digest. When CI builds the image, the result is addressed by a `sha256:` digest — a content identifier that "uniquely identifies content by taking a collision-resistant hash of the bytes" ([OCI image-spec descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)). That digest, together with the signed attestations attached to it — build provenance, software bill of materials, scan and test results — is the release candidate.

It is immutable by construction. The same bytes always produce the same digest, and any change produces a different one. A stabilization branch can drift; a digest cannot. Nobody can quietly cherry-pick one more fix onto a digest. If the bytes change, it is a different artifact with a different name, and you will know.

That is why the model works *better* than `release/*` for continuous delivery, not merely simpler. A branch is a place where things can still change. An attested digest is a fixed thing you can verify. Promotion becomes "move this exact verified digest forward and re-check it," not "merge a few more commits onto the release branch and hope it is still stable."

## When git-flow still earns its cost

The note of reflection is explicit about the exception, and so am I. Git-flow's machinery earns its complexity when you are "building software that is explicitly versioned, or if you need to support multiple versions of your software in the wild" ([nvie.com](https://nvie.com/posts/a-successful-git-branching-model/)).

If you ship and patch 1.4.x, 1.5.x, and 2.0.x simultaneously — long-lived maintenance branches for released versions, with backports flowing between them — then `release/*` and the branch topology around it are doing real work that a single `main` cannot do. Desktop applications, libraries with supported LTS lines, firmware, anything where customers run old versions you are still obligated to patch: that is git-flow's home turf, and it is a good fit there.

A continuously delivered service that always runs exactly one version in production is not that case. There is no 1.4.x to backport to, because 1.4.x does not exist anywhere; there is only what is in production right now. For that shape, the simpler model wins, and the release candidate is an attested digest.

Choose the model that matches the thing you are actually shipping. If you run one version, run GitHub Flow and let the digest be your release. If you support many versions in the wild, git-flow is still as good a fit as it ever was — just not for the problem in front of most service teams.
