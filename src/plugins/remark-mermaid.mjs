import { visit } from 'unist-util-visit';

/**
 * Convert ```mermaid fenced code blocks into a raw <pre class="mermaid"> element
 * BEFORE Expressive Code treats them as code. Mermaid source is HTML-escaped so
 * the browser's textContent round-trips back to the exact diagram source for
 * mermaid.run() to consume client-side.
 */
export default function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || node.lang !== 'mermaid') return;
      const escaped = node.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      parent.children[index] = {
        type: 'html',
        value: `<pre class="mermaid" aria-label="diagram">${escaped}</pre>`,
      };
    });
  };
}
