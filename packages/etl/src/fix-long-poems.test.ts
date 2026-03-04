import { describe, expect, test } from 'bun:test';
import { cleanAndSplit, POEM_TARGETS } from './fix-long-poems';

describe('POEM_TARGETS', () => {
  test('matches the 6 scoped remediation IDs in execution ticket', () => {
    expect(POEM_TARGETS.map((t) => t.poemId)).toEqual([
      '19176bc9d632',
      'b45e1e960ad8',
      '92273a10aba0',
      'c8d1c4ef3331',
      'f399fdc5e1ab',
      'd87091e153a9',
    ]);
  });

  test('uses explicit strategy per scoped ID', () => {
    expect(POEM_TARGETS).toEqual([
      { poemId: '19176bc9d632', strategy: 'delete-stale-original' },
      { poemId: 'b45e1e960ad8', strategy: 'delete-stale-original' },
      { poemId: '92273a10aba0', strategy: 'delete-stale-original' },
      { poemId: 'c8d1c4ef3331', strategy: 'delete-stale-original' },
      { poemId: 'f399fdc5e1ab', strategy: 'classify' },
      { poemId: 'd87091e153a9', strategy: 'delete-artefact' },
    ]);
  });
});

describe('cleanAndSplit', () => {
  test('drops roman numeral and all-caps editorial headers in normal stanza format', () => {
    const content = [
      'I',
      'A JOURNAL',
      'First line of stanza one.\nSecond line of stanza one.',
      'First line of stanza two.\nSecond line of stanza two.',
    ].join('\n\n');

    const parts = cleanAndSplit(content);

    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('First line of stanza one.');
    expect(parts[0]).toContain('First line of stanza two.');
    expect(parts[0]).not.toContain('A JOURNAL');
    expect(parts[0]).not.toContain('\n\nI\n\n');
  });

  test('preserves roman-section boundaries for all-double-newline poems', () => {
    const content = ['I', 'Line 1', 'Line 2', 'Line 3', 'Line 4', 'II', 'Line 5', 'Line 6'].join(
      '\n\n',
    );

    const parts = cleanAndSplit(content, 2);

    expect(parts).toEqual(['Line 1\nLine 2\n\nLine 3\nLine 4\n\nLine 5\nLine 6']);
  });

  test('reassembles fixed-line stanzas for all-double-newline poems without roman sections', () => {
    const content = ['line a1', 'line a2', 'line a3', 'line b1', 'line b2', 'line b3'].join('\n\n');

    const parts = cleanAndSplit(content, 3);

    expect(parts).toEqual(['line a1\nline a2\nline a3\n\nline b1\nline b2\nline b3']);
  });
});
