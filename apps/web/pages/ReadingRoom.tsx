import React, { useState, useEffect, useRef } from 'react';
import { AuthorType, ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';
import { VerdictPopup } from '../components/VerdictPopup';
import { SwipeContainer, type SwipePhase } from '../components/SwipeContainer';
import { api, type AnonymousDuel, type DuelStats } from '../lib/api';
import {
  createQueue,
  queueAppendPage,
  queueAdvance,
  queueCurrentId,
  queueNextIds,
  queueNeedsMoreIds,
  type DuelQueueState,
} from '../lib/duelQueue';

/** Expected page size from GET /duels — used to detect last page. */
const PAGE_SIZE = 10;
/** Number of upcoming duels to pre-fetch while user reads the current one. */
const PREFETCH_COUNT = 2;

interface ReadingRoomProps {
  duelId: string | null;
  onNavigate: (view: ViewState, duelId?: string) => void;
}

export const ReadingRoom: React.FC<ReadingRoomProps> = ({ duelId, onNavigate }) => {
  const [duel, setDuel] = useState<AnonymousDuel | null>(null);
  const [stats, setStats] = useState<DuelStats | null>(null);
  const [selectedPoemId, setSelectedPoemId] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swipePhase, setSwipePhase] = useState<SwipePhase>('idle');

  // Sliding window queue — held in a ref to avoid stale closures in async callbacks
  const queueRef = useRef<DuelQueueState>(createQueue());
  // Cache of pre-fetched full duel objects keyed by duel ID
  const prefetchCacheRef = useRef<Map<string, AnonymousDuel>>(new Map());
  // Guard against concurrent page fetches
  const isFetchingMoreRef = useRef(false);

  /** Pre-fetch the next PREFETCH_COUNT duels into the cache. Non-fatal on failure. */
  const prefetchUpcoming = (queue: DuelQueueState) => {
    const toFetch = queueNextIds(queue, PREFETCH_COUNT).filter(
      (id) => !prefetchCacheRef.current.has(id),
    );
    for (const id of toFetch) {
      api
        .getDuel(id)
        .then((d) => prefetchCacheRef.current.set(id, d))
        .catch(() => {
          /* pre-fetch failure is non-fatal */
        });
    }
  };

  /** Fetch the next page of duel IDs when approaching the end of the queue. */
  const maybeFetchMoreIds = async (queue: DuelQueueState) => {
    if (isFetchingMoreRef.current || !queueNeedsMoreIds(queue, PREFETCH_COUNT)) return;
    isFetchingMoreRef.current = true;
    try {
      const items = await api.getDuels(queue.currentPage);
      const newIds = items.map((item) => item.id);
      const isLastPage = newIds.length < PAGE_SIZE;
      const latestQueue = queueRef.current;
      const nextQueue = queueAppendPage(latestQueue, newIds, isLastPage);
      queueRef.current = nextQueue;
      prefetchUpcoming(nextQueue);
    } catch {
      /* non-fatal — user can still view cached duels */
    } finally {
      isFetchingMoreRef.current = false;
    }
  };

  useEffect(() => {
    const loadInitial = async () => {
      try {
        let id = duelId;

        if (!id) {
          // No specific duel requested — fetch the list and start a queue
          const items = await api.getDuels(1);
          if (items.length === 0) {
            setError('No duels available. Please check back later.');
            return;
          }
          const ids = items.map((item) => item.id);
          const isLastPage = ids.length < PAGE_SIZE;
          const initialQueue = queueAppendPage(createQueue(), ids, isLastPage);
          queueRef.current = initialQueue;
          id = queueCurrentId(initialQueue)!;
          prefetchUpcoming(initialQueue);
        } else {
          // Specific duel requested — initialize queue so swipe/next flow still works
          const items = await api.getDuels(1).catch(() => null);
          if (items && items.length > 0) {
            const ids = items.map((item) => item.id);
            const isLastPage = ids.length < PAGE_SIZE;
            const requestedIndex = ids.indexOf(id);
            const queueIds = requestedIndex >= 0 ? ids : [id, ...ids];
            const initialQueue = {
              ...queueAppendPage(createQueue(), queueIds, isLastPage),
              currentIndex: requestedIndex >= 0 ? requestedIndex : 0,
            };
            queueRef.current = initialQueue;
            prefetchUpcoming(initialQueue);
          } else {
            queueRef.current = { ...createQueue(), ids: [id], hasMore: false };
          }
        }

        const d = await api.getDuel(id);
        setDuel(d);
        setTimeout(() => setFadeIn(true), 100);
      } catch {
        setError('Could not load the duel. Please try again.');
      }
    };
    loadInitial();
  }, [duelId]);

  const handleVote = async (poemId: string) => {
    if (!duel || hasVoted) return;
    setSelectedPoemId(poemId);
    setHasVoted(true);
    try {
      await api.vote(duel.id, poemId);
      const duelStats = await api.getDuelStats(duel.id);
      setStats(duelStats);
    } catch {
      // Show popup even if stats fetch fails
    }
    setShowPopup(true);
  };

  /** User clicked "Next Duel" in the VerdictPopup. */
  const handleContinue = () => {
    setShowPopup(false);
    setSwipePhase('swipe-out');
  };

  /** Swipe-out animation finished — swap to next duel and start swipe-in. */
  const handleSwipeOutComplete = async () => {
    const nextQueue = queueAdvance(queueRef.current);
    queueRef.current = nextQueue;

    const nextId = queueCurrentId(nextQueue);
    if (!nextId) {
      // Queue exhausted — fall back to Anthology
      onNavigate(ViewState.ANTHOLOGY);
      return;
    }

    // Load from pre-fetch cache if available, otherwise fetch now
    const cached = prefetchCacheRef.current.get(nextId);
    const nextDuel = cached ?? (await api.getDuel(nextId).catch(() => null));

    if (!nextDuel) {
      setError('Could not load the next duel. Please try again.');
      return;
    }

    // Reset voting state for the new duel
    setDuel(nextDuel);
    setStats(null);
    setSelectedPoemId(null);
    setHasVoted(false);
    setSwipePhase('swipe-in');

    prefetchUpcoming(nextQueue);
    maybeFetchMoreIds(nextQueue);
  };

  const handleSwipeInComplete = () => {
    setSwipePhase('idle');
  };

  if (error) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <p className="font-serif text-pencil italic">{error}</p>
      </div>
    );
  }

  if (!duel) {
    return (
      <div className="flex-grow flex items-center justify-center">
        <p className="font-sans text-xs tracking-widest uppercase text-pencil animate-pulse">
          Loading...
        </p>
      </div>
    );
  }

  return (
    <>
      <VerdictPopup
        isOpen={showPopup}
        selectedPoemId={selectedPoemId}
        stats={stats}
        onContinue={handleContinue}
        onReviewPoems={() => setShowPopup(false)}
      />

      <SwipeContainer
        swipePhase={swipePhase}
        onSwipeOutComplete={handleSwipeOutComplete}
        onSwipeInComplete={handleSwipeInComplete}
      >
        <div
          className={`flex flex-col w-full h-full transition-opacity duration-1000 overflow-y-auto lg:overflow-hidden no-scrollbar ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Header Info */}
          <div className="w-full text-center py-6 border-b border-stock/30 shrink-0">
            <p className="font-sans text-xs tracking-[0.2em] uppercase text-pencil">Subject</p>
            <p className="font-serif text-2xl italic text-ink mt-1">{duel.topic}</p>
          </div>

          {/* Split Screen Container */}
          <div className="flex-grow flex flex-col lg:flex-row relative min-h-0">
            {/* Divider (Desktop) */}
            <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-border-pencil z-10"></div>

            {/* Poem A */}
            <PoemColumn
              poem={duel.poemA}
              revealedPoem={stats?.duel.poemA ?? null}
              label="Exhibit A"
              revealed={showPopup}
              isSelected={selectedPoemId === duel.poemA.id}
              onSelect={() => handleVote(duel.poemA.id)}
              disabled={hasVoted}
              isLeft={true}
            />

            {/* Poem B */}
            <PoemColumn
              poem={duel.poemB}
              revealedPoem={stats?.duel.poemB ?? null}
              label="Exhibit B"
              revealed={showPopup}
              isSelected={selectedPoemId === duel.poemB.id}
              onSelect={() => handleVote(duel.poemB.id)}
              disabled={hasVoted}
            />
          </div>
        </div>
      </SwipeContainer>
    </>
  );
};

interface PoemColumnProps {
  poem: { id: string; title: string; content: string };
  revealedPoem: { author: string; year?: string; type: AuthorType; title: string } | null;
  label: string;
  revealed: boolean;
  isSelected: boolean;
  onSelect: () => void;
  disabled: boolean;
  isLeft?: boolean;
}

const PoemColumn: React.FC<PoemColumnProps> = ({
  poem,
  revealedPoem,
  label,
  revealed,
  isSelected,
  onSelect,
  disabled,
  isLeft,
}) => {
  const isHuman = revealedPoem?.type === AuthorType.HUMAN;
  const authorColor = isHuman ? 'text-seal-red' : 'text-binding-blue';
  const labelText = isHuman ? 'Human' : 'Artificial Intelligence';

  return (
    <div
      className={`
        flex-1 relative transition-colors duration-700
        lg:overflow-y-auto lg:h-full letterpress-scroll
        ${revealed && isSelected ? 'bg-stock/30' : ''}
      `}
      style={{ direction: isLeft ? 'rtl' : 'ltr' }}
    >
      <div
        className="flex flex-col min-h-full p-8 md:p-16 lg:p-20 relative"
        style={{ direction: 'ltr' }}
      >
        {/* Reveal Header */}
        <div
          className={`text-center mb-12 h-20 flex flex-col justify-end transition-opacity duration-700 ${revealed ? 'opacity-100' : 'opacity-0'}`}
        >
          {revealedPoem && (
            <>
              <span
                className={`font-sans text-[10px] uppercase tracking-[0.2em] font-bold ${authorColor} mb-2 block`}
              >
                {labelText}
              </span>
              <h3 className={`text-2xl font-serif font-bold italic ${authorColor}`}>
                {revealedPoem.author}
              </h3>
              <span className="text-xs font-sans text-pencil mt-1">{revealedPoem.year}</span>
            </>
          )}
        </div>

        {/* Anonymized Header */}
        {!revealed && (
          <div className="absolute top-16 left-0 right-0 text-center pointer-events-none">
            <span className="inline-block border-b border-pencil/30 pb-2 px-4 font-serif font-bold text-lg tracking-widest text-pencil/60 uppercase">
              {label}
            </span>
          </div>
        )}

        {/* Poem Content */}
        <div className="prose prose-lg mx-auto max-w-md font-body text-xl leading-relaxed whitespace-pre-line text-ink">
          {revealed && (
            <div className="mb-6 text-center md:text-left">
              <p className="font-serif font-bold italic text-2xl mb-6">{poem.title}</p>
            </div>
          )}
          {poem.content}
        </div>

        {/* Selection Button */}
        {!revealed && (
          <div className="mt-auto pt-16 flex justify-center sticky bottom-8 z-10">
            <Button
              variant="outline"
              onClick={onSelect}
              disabled={disabled}
              className="bg-paper/90 backdrop-blur-sm shadow-sm"
            >
              <span className="material-symbols-outlined text-lg mr-2">edit_note</span>
              Select This Work
            </Button>
          </div>
        )}

        {/* Result Badge */}
        {revealed && isSelected && (
          <div className="absolute top-6 right-6">
            <div className="flex items-center gap-2 text-ink/60 bg-stock px-3 py-1.5 rounded border border-border-pencil">
              <span className="material-symbols-outlined text-sm">check</span>
              <span className="text-xs font-sans font-medium uppercase tracking-wide">
                Your Choice
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
