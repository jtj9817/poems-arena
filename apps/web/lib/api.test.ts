import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiRequestError, api } from './api';
import { AuthorType } from '@sanctuary/shared';

const mockOkResponse = (data: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });

describe('api.getTopics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the /topics endpoint', async () => {
    const fetchMock = mockOkResponse([{ id: 't1', label: 'Nature' }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getTopics();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toMatch(/\/topics$/);
    expect(result).toEqual([{ id: 't1', label: 'Nature' }]);
  });

  it('returns empty array when no topics exist', async () => {
    vi.stubGlobal('fetch', mockOkResponse([]));

    const result = await api.getTopics();

    expect(result).toEqual([]);
  });
});

describe('api.getDuelStats', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls /duels/:id/stats endpoint', async () => {
    const statsPayload = {
      humanWinRate: 70,
      avgReadingTime: '3m 00s',
      duel: {
        id: 'duel-123',
        topic: 'Nature',
        poemA: { id: 'p1', title: 'T', content: 'C', author: 'Emily Dickinson', type: 'HUMAN' },
        poemB: { id: 'p2', title: 'T', content: 'C', author: 'Claude AI', type: 'AI' },
      },
    };
    const fetchMock = mockOkResponse(statsPayload);
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getDuelStats('duel-123');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toMatch(/\/duels\/duel-123\/stats$/);
    expect(result.humanWinRate).toBe(70);
    expect(result.avgReadingTime).toBe('3m 00s');
  });

  it('exposes sourceInfo on duel.poemA and duel.poemB when present', async () => {
    const sourceInfoHuman = {
      primary: { source: 'poets.org', sourceUrl: 'https://poets.org/poem' },
      provenances: [
        {
          source: 'poets.org',
          sourceUrl: 'https://poets.org',
          scrapedAt: '2024-01-01',
          isPublicDomain: true,
        },
      ],
    };
    const sourceInfoAI = {
      primary: { source: null, sourceUrl: null },
      provenances: [],
    };
    const statsPayload = {
      humanWinRate: 55,
      avgReadingTime: '2m 10s',
      duel: {
        id: 'duel-456',
        topic: 'Love',
        poemA: {
          id: 'p1',
          title: 'My Title',
          content: 'Content here',
          author: 'Emily Dickinson',
          type: AuthorType.HUMAN,
          year: '1890',
          sourceInfo: sourceInfoHuman,
        },
        poemB: {
          id: 'p2',
          title: 'AI Title',
          content: 'AI content',
          author: 'Claude 3 Opus',
          type: AuthorType.AI,
          sourceInfo: sourceInfoAI,
        },
      },
    };
    const fetchMock = mockOkResponse(statsPayload);
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getDuelStats('duel-456');

    expect(result.duel.poemA.sourceInfo?.primary.source).toBe('poets.org');
    expect(result.duel.poemA.sourceInfo?.provenances).toHaveLength(1);
    expect(result.duel.poemB.sourceInfo?.primary.source).toBeNull();
    expect(result.duel.poemB.sourceInfo?.provenances).toHaveLength(0);
  });

  it('handles missing sourceInfo gracefully (field is optional)', async () => {
    const statsPayload = {
      humanWinRate: 0,
      avgReadingTime: '1m 00s',
      duel: {
        id: 'duel-789',
        topic: 'Loss',
        poemA: { id: 'p1', title: 'T', content: 'C', author: 'Author A', type: 'HUMAN' },
        poemB: { id: 'p2', title: 'T', content: 'C', author: 'Author B', type: 'AI' },
      },
    };
    const fetchMock = mockOkResponse(statsPayload);
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getDuelStats('duel-789');

    expect(result.duel.poemA.sourceInfo).toBeUndefined();
    expect(result.duel.poemB.sourceInfo).toBeUndefined();
  });
});

describe('api.getDuels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls /duels with page param only when no topicId given', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(1);

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('/duels');
    expect(url).toContain('page=1');
    expect(url).not.toContain('topic_id');
    expect(url).not.toContain('seed=');
    expect(url).not.toContain('sort=');
  });

  it('appends topic_id when topicId is provided', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(1, 'topic-abc');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('topic_id=topic-abc');
    expect(url).toContain('page=1');
  });

  it('appends seed when provided', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(1, undefined, 42);

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('page=1');
    expect(url).toContain('seed=42');
    expect(url).not.toContain('sort=');
  });

  it('appends sort when provided', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(1, undefined, undefined, 'recent');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('page=1');
    expect(url).toContain('sort=recent');
    expect(url).not.toContain('seed=');
  });

  it('does not append topic_id when topicId is undefined', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(2, undefined);

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('page=2');
    expect(url).not.toContain('topic_id');
  });

  it('defaults to page 1', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels();

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('page=1');
  });
});

describe('request error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ApiRequestError with status and code for structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: 'Database is not ready',
              code: 'SERVICE_UNAVAILABLE',
            }),
          ),
      }),
    );

    const result = await api.getDuels().then(
      () => null,
      (error) => error,
    );

    expect(result).toBeInstanceOf(ApiRequestError);
    const requestError = result as ApiRequestError;
    expect(requestError.status).toBe(503);
    expect(requestError.code).toBe('SERVICE_UNAVAILABLE');
    expect(requestError.message).toBe('Database is not ready');
  });

  it('throws ApiRequestError with raw body when API response is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('bad gateway'),
      }),
    );

    const result = await api.getDuels().then(
      () => null,
      (error) => error,
    );

    expect(result).toBeInstanceOf(ApiRequestError);
    const requestError = result as ApiRequestError;
    expect(requestError.status).toBe(502);
    expect(requestError.message).toContain('API error 502');
    expect(requestError.message).toContain('bad gateway');
    expect(requestError.code).toBeUndefined();
  });
});
