import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api';

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
  });

  it('appends topic_id when topicId is provided', async () => {
    const fetchMock = mockOkResponse([]);
    vi.stubGlobal('fetch', fetchMock);

    await api.getDuels(1, 'topic-abc');

    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('topic_id=topic-abc');
    expect(url).toContain('page=1');
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
