import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://attested-delivery.github.io',
  base: '/docs',
  vite: {
    ssr: {
      noExternal: ['unist-util-visit', 'unist-util-visit-parents'],
    },
  },
  integrations: [
    starlight({
      title: 'Attested Delivery',
      description: 'Documentation for the attested-delivery GitHub organization: signed, SLSA-attested, fail-closed-verified releases.',
      sidebar: [
        { label: 'Overview', link: '/overview/' },
        {
          label: 'Concepts',
          items: [
            { label: 'The Digest Is the Release', link: '/concepts/01-the-digest-is-the-release/' },
            { label: 'GitHub Flow over Git Flow', link: '/concepts/02-github-flow-over-git-flow/' },
            { label: 'Attestations That Survive Promotion', link: '/concepts/03-attestations-that-survive-promotion/' },
            { label: 'Enforce at Admission Not by Convention', link: '/concepts/04-enforce-at-admission-not-by-convention/' },
            { label: 'SLSA L3 Is Nearly Free', link: '/concepts/05-slsa-l3-is-nearly-free/' },
            { label: 'An SBOM You Can Actually Use', link: '/concepts/06-an-sbom-you-can-actually-use/' },
            { label: 'Supply Chain Hazards 2026', link: '/concepts/07-supply-chain-hazards-2026/' },
            { label: 'Honest DORA: Defining Deployment', link: '/concepts/08-honest-dora-defining-deployment/' },
            { label: 'AI Authorship Provenance', link: '/concepts/09-ai-authorship-provenance/' },
            { label: 'Observability for a Delivery Pipeline', link: '/concepts/10-observability-for-a-delivery-pipeline/' },
          ],
        },
        {
          label: 'Specifications',
          items: [
            { label: 'Research Report', link: '/specifications/research-report/' },
            { label: 'Interface Contracts', link: '/specifications/interface-contracts/' },
            { label: 'Promotion Attestation Pipeline', link: '/specifications/promotion-attestation-pipeline-spec/' },
            { label: 'Production Readiness Gates', link: '/specifications/production-readiness-attestation-gates/' },
            { label: 'GitHub Native Quality Gates', link: '/specifications/github-native-attested-quality-gates/' },
          ],
        },
        {
          label: 'Architecture Decisions',
          items: [
            { label: 'ADR-0056: Digest Promotion', link: '/adrs/0056-attestation-preserving-digest-promotion/' },
            { label: 'ADR-0057: SLSA Build Level 3', link: '/adrs/0057-declare-slsa-build-level-3/' },
            { label: 'ADR-0058: SBOM Format', link: '/adrs/0058-sbom-format-cyclonedx-spdx-oci-referrers/' },
            { label: 'ADR-0059: Admission Verification', link: '/adrs/0059-admission-time-attestation-verification/' },
            { label: 'ADR-0060: AI Provenance Git Trailers', link: '/adrs/0060-ai-provenance-git-trailers/' },
            { label: 'ADR-0061: DORA Instrumentation', link: '/adrs/0061-dora-instrumentation-deployment-definition/' },
            { label: 'ADR-0062: GitHub Flow Branching Policy', link: '/adrs/0062-github-flow-artifact-promotion-branching-policy/' },
            { label: 'ADR-0063: Security Tooling Pins', link: '/adrs/0063-syft-grype-pin-security-tooling-by-digest/' },
          ],
        },
      ],
    }),
  ],
});
