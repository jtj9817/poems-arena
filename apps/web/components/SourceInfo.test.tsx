import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthorType } from '@sanctuary/shared';
import { SourceInfo } from './SourceInfo';

describe('SourceInfo', () => {
  it('renders a link for safe source URLs', () => {
    const html = renderToStaticMarkup(
      <SourceInfo
        idPrefix="source-info"
        author="Emily Dickinson"
        type={AuthorType.HUMAN}
        sourceInfo={{
          primary: {
            source: 'Poetry Foundation',
            sourceUrl: 'https://poetryfoundation.org/poem/1',
          },
          provenances: [],
        }}
      />,
    );

    expect(html).toContain('id="source-info-source-link"');
    expect(html).toContain('href="https://poetryfoundation.org/poem/1"');
  });

  it('does not render a link for unsafe source URLs', () => {
    const html = renderToStaticMarkup(
      <SourceInfo
        idPrefix="source-info"
        author="Emily Dickinson"
        type={AuthorType.HUMAN}
        sourceInfo={{
          primary: {
            source: 'Poetry Foundation',
            sourceUrl: "javascript:alert('xss')",
          },
          provenances: [],
        }}
      />,
    );

    expect(html).not.toContain('id="source-info-source-link"');
    expect(html).not.toContain('href="javascript:alert');
    expect(html).toContain('Poetry Foundation');
  });
});
