import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthorType } from '@sanctuary/shared';
import { VerdictPopup } from './VerdictPopup';

const mockStats = {
  humanWinRate: 75,
  globalStats: {
    totalVotes: 1000,
    humanWinRate: 60,
    avgDecisionTimeMs: 120000,
    avgDecisionTime: '2m 00s',
  },
  topicStats: {
    topicMeta: { id: 'topic-1', label: 'Nature' },
    totalVotes: 100,
    humanWinRate: 65,
    avgDecisionTimeMs: 60000,
    avgDecisionTime: '1m 00s',
  },
  duel: {
    id: 'duel-1',
    topic: 'Nature',
    topicMeta: { id: 'topic-1', label: 'Nature' },
    poemA: {
      id: 'poem-1',
      title: 'Poem A',
      content: 'Content A',
      author: 'Author A',
      type: AuthorType.HUMAN,
      year: '1850',
    },
    poemB: {
      id: 'poem-2',
      title: 'Poem B',
      content: 'Content B',
      author: 'AI',
      type: AuthorType.AI,
    },
  },
};

describe('VerdictPopup', () => {
  it('renders the detailed stats section when stats are provided', () => {
    const html = renderToStaticMarkup(
      <VerdictPopup
        isOpen={true}
        selectedPoemId="poem-1"
        stats={mockStats}
        onContinue={() => {}}
        onReviewPoems={() => {}}
      />,
    );

    // Check for "The Verdict" and the verdict message
    expect(html).toContain('The Verdict');
    expect(html).toContain('You recognized the Human.');

    // Check for Recognition Rate section
    expect(html).toContain('Recognition Rate');
    expect(html).toContain('Global Average');
    expect(html).toContain('60%');
    expect(html).toContain('Topic: Nature');
    expect(html).toContain('65%');

    // Check for delta
    const upDelta = Math.abs(
      mockStats.topicStats.humanWinRate - mockStats.globalStats.humanWinRate,
    );
    expect(html).toContain(`↑ ${upDelta}% vs global`);

    // Check for Avg. Decision Time section
    expect(html).toContain('Avg. Decision Time');
    expect(html).toContain('Global');
    expect(html).toContain('2m 00s');
    expect(html).toContain('Topic');
    expect(html).toContain('1m 00s');
  });

  it('renders "—" fallback when avgDecisionTime is null', () => {
    const statsWithNullTiming = {
      ...mockStats,
      globalStats: { ...mockStats.globalStats, avgDecisionTimeMs: null, avgDecisionTime: null },
      topicStats: { ...mockStats.topicStats, avgDecisionTimeMs: null, avgDecisionTime: null },
    };
    const html = renderToStaticMarkup(
      <VerdictPopup
        isOpen={true}
        selectedPoemId="poem-1"
        stats={statsWithNullTiming}
        onContinue={() => {}}
        onReviewPoems={() => {}}
      />,
    );

    // Recognition rate section should still render
    expect(html).toContain('Recognition Rate');
    // Decision time should fall back to "—"
    expect(html).toContain('Avg. Decision Time');
    const dashCount = (html.match(/—/g) ?? []).length;
    expect(dashCount).toBe(2);
    expect(html).not.toContain('2m 00s');
    expect(html).not.toContain('1m 00s');
  });

  it('renders downward delta when topic rate is lower than global', () => {
    const statsWithLowerTopic = {
      ...mockStats,
      globalStats: { ...mockStats.globalStats, humanWinRate: 70 },
      topicStats: { ...mockStats.topicStats, humanWinRate: 55 },
    };
    const html = renderToStaticMarkup(
      <VerdictPopup
        isOpen={true}
        selectedPoemId="poem-1"
        stats={statsWithLowerTopic}
        onContinue={() => {}}
        onReviewPoems={() => {}}
      />,
    );

    const downDelta = Math.abs(
      statsWithLowerTopic.topicStats.humanWinRate - statsWithLowerTopic.globalStats.humanWinRate,
    );
    expect(html).toContain(`↓ ${downDelta}% vs global`);
  });

  it('renders correctly when stats are null', () => {
    const html = renderToStaticMarkup(
      <VerdictPopup
        isOpen={true}
        selectedPoemId="poem-1"
        stats={null}
        onContinue={() => {}}
        onReviewPoems={() => {}}
      />,
    );

    expect(html).toContain('The Verdict');
    expect(html).not.toContain('Recognition Rate');
    expect(html).not.toContain('Avg. Decision Time');
  });
});
