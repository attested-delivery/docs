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
            { label: 'ADR-0001: Digest Promotion', link: '/adrs/0001-attestation-preserving-digest-promotion/' },
            { label: 'ADR-0002: SLSA Build Level 3', link: '/adrs/0002-declare-slsa-build-level-3/' },
            { label: 'ADR-0003: SBOM Format', link: '/adrs/0003-sbom-format-cyclonedx-spdx-oci-referrers/' },
            { label: 'ADR-0004: Admission Verification', link: '/adrs/0004-admission-time-attestation-verification/' },
            { label: 'ADR-0005: AI Provenance Git Trailers', link: '/adrs/0005-ai-provenance-git-trailers/' },
            { label: 'ADR-0006: DORA Instrumentation', link: '/adrs/0006-dora-instrumentation-deployment-definition/' },
            { label: 'ADR-0007: GitHub Flow Branching Policy', link: '/adrs/0007-github-flow-artifact-promotion-branching-policy/' },
            { label: 'ADR-0008: Security Tooling Pins', link: '/adrs/0008-syft-grype-pin-security-tooling-by-digest/' },
          ],
        },
      ],
    }),
  ],
});
