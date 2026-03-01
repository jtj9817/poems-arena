import { describe, expect, mock, test } from 'bun:test';
import type { PoemOutput } from './deepseek-client';
import {
  buildAiPoemInsertValues,
  fetchUnmatchedHumanPoems,
  persistGeneratedPoem,
  type HumanPoemCandidate,
  type PersistenceDb,
} from './persistence';

function createMockDb(rowsByCall: Array<Array<Record<string, unknown>>> = []): PersistenceDb & {
  execute: ReturnType<typeof mock>;
} {
  let index = 0;
  const execute = mock(async (_query: string, _params?: unknown[]) => ({
    rows: rowsByCall[index++] ?? [],
  }));

  return {
    execute,
  };
}

describe('buildAiPoemInsertValues', () => {
  test('transforms generated output into poems insert shape', () => {
    const generatedPoem: PoemOutput = {
      title: 'Counterpart',
      content: 'line one\nline two\nline three\nline four',
    };
    const parentPoem: HumanPoemCandidate = {
      id: 'human-1',
      title: 'Original',
      content: 'a\nb\nc\nd',
    };

    const result = buildAiPoemInsertValues({
      parentPoem,
      generatedPoem,
      prompt: 'Write a poem about storms',
      model: 'deepseek-chat',
    });

    expect(result.type).toBe('AI');
    expect(result.author).toBe('deepseek-chat');
    expect(result.parentPoemId).toBe('human-1');
    expect(result.prompt).toBe('Write a poem about storms');
    expect(result.source).toBe('ai-generated');
    expect(result.id).toContain('human-1');
  });
});

describe('persistGeneratedPoem', () => {
  test('inserts transformed AI poem row and verifies storage succeeded', async () => {
    const storedRow = {
      id: 'ai-human-1-abcdef',
      title: 'Counterpart',
      content: 'line one\nline two\nline three\nline four',
      author: 'deepseek-chat',
      type: 'AI',
      prompt: 'Write a poem about storms',
      parentPoemId: 'human-1',
      source: 'ai-generated',
    };
    const db = createMockDb([[], [], [storedRow]]);

    const result = await persistGeneratedPoem({
      db,
      parentPoem: {
        id: 'human-1',
        title: 'Original',
        content: 'a\nb\nc\nd',
      },
      generatedPoem: {
        title: 'Counterpart',
        content: 'line one\nline two\nline three\nline four',
      },
      prompt: 'Write a poem about storms',
      model: 'deepseek-chat',
    });

    expect(db.execute).toHaveBeenCalledTimes(3);
    const insertCall = db.execute.mock.calls[0];
    expect(insertCall?.[0]).toContain('INSERT OR IGNORE INTO poems');
    expect(insertCall?.[1]).toEqual([
      expect.stringContaining('ai-human-1-'),
      'Counterpart',
      'line one\nline two\nline three\nline four',
      'deepseek-chat',
      'AI',
      'ai-generated',
      'Write a poem about storms',
      'human-1',
    ]);
    expect(result).toEqual(storedRow);
  });
});

describe('fetchUnmatchedHumanPoems', () => {
  test('returns unmatched HUMAN poems from the database query result', async () => {
    const db = createMockDb([
      [
        {
          id: 'human-1',
          title: 'Human Poem',
          content: 'line 1\nline 2\nline 3\nline 4',
        },
      ],
    ]);

    const result = await fetchUnmatchedHumanPoems({
      db,
      topic: 'nature',
      limit: 25,
    });

    expect(db.execute).toHaveBeenCalledTimes(1);
    const fetchCall = db.execute.mock.calls[0];
    expect(fetchCall?.[0]).toContain("WHERE p.type = 'HUMAN'");
    expect(fetchCall?.[0]).toContain('LOWER(?) OR LOWER(t.label) = LOWER(?)');
    expect(fetchCall?.[0]).toContain('LIMIT ?');
    expect(fetchCall?.[1]).toEqual(['nature', 'nature', 25]);
    expect(result).toEqual([
      {
        id: 'human-1',
        title: 'Human Poem',
        content: 'line 1\nline 2\nline 3\nline 4',
      },
    ]);
  });
});
