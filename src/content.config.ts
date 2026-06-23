import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // Extend Starlight's docs schema with optional Diátaxis classification
    // frontmatter so each page can declare its quadrant.
    schema: docsSchema({
      extend: z.object({
        diataxis_type: z
          .enum(['tutorial', 'how-to', 'reference', 'explanation'])
          .optional(),
        diataxis_topic: z.string().optional(),
        diataxis_goal: z.string().optional(),
        diataxis_describes: z.string().optional(),
        diataxis_learning_goals: z.array(z.string()).optional(),
      }),
    }),
  }),
};
