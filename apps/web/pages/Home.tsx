import React, { useState, useEffect } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';
import { ApiRequestError, api, type DuelListItem } from '../lib/api';
import metadataJson from '../metadata.json';

const appVersion =
  typeof (metadataJson as Record<string, unknown>).version === 'string' &&
  /^\d+\.\d+$/.test((metadataJson as Record<string, unknown>).version as string)
    ? ((metadataJson as Record<string, unknown>).version as string)
    : null;

interface HomeProps {
  onNavigate: (view: ViewState, duelId?: string) => void;
}

const COLD_START_RETRY_DELAYS_MS = [500, 900, 1400, 2000];

const STATUS_MESSAGES = [
  'Establishing archive connection',
  'Warming the ring',
  'Preparing the contestants',
  'Retrieving from the stacks',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableColdStartError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 503;
}

export const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [featuredDuel, setFeaturedDuel] = useState<DuelListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [loadCycle, setLoadCycle] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setStatusIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    let isCurrent = true;

    const loadFeaturedDuel = async () => {
      setLoading(true);
      setLoadError(null);
      setRetryCount(0);
      setFeaturedDuel(null);

      for (let attempt = 0; attempt <= COLD_START_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const duels = await api.getDuels();
          if (!isCurrent) return;
          if (duels.length > 0) {
            setFeaturedDuel(duels[0]);
          }
          setLoading(false);
          return;
        } catch (error) {
          if (!isCurrent) return;

          const canRetry =
            isRetryableColdStartError(error) && attempt < COLD_START_RETRY_DELAYS_MS.length;

          if (!canRetry) {
            console.error(error);
            setLoadError('The archive is still waking up. Please try again.');
            setLoading(false);
            return;
          }

          setRetryCount(attempt + 1);
          await sleep(COLD_START_RETRY_DELAYS_MS[attempt]!);
        }
      }
    };

    void loadFeaturedDuel();

    return () => {
      isCurrent = false;
    };
  }, [loadCycle]);

  const handleStart = () => {
    if (!featuredDuel) return;
    setIsExiting(true);
    setTimeout(() => {
      onNavigate(ViewState.THE_RING, featuredDuel.id);
    }, 600); // Match CSS transition
  };

  const handleRetry = () => {
    setLoadCycle((value) => value + 1);
  };

  return (
    <div
      id="home-page"
      className={`h-full w-full overflow-y-auto no-scrollbar flex items-center justify-center`}
    >
      <div
        id="home-hero-section"
        className={`flex-grow flex flex-col items-center justify-center px-6 py-12 transition-opacity duration-700 ${isExiting ? 'opacity-0 translate-y-4' : 'opacity-100'}`}
      >
        <div id="home-hero-content" className="max-w-3xl text-center space-y-12">
          <div id="home-hero-copy" className="space-y-6">
            <div id="home-hero-kicker" className="inline-block border-b border-seal-red/30 pb-1">
              <span className="font-sans text-xs tracking-[0.2em] uppercase font-medium text-seal-red">
                Daily Challenge
              </span>
            </div>

            <h2
              id="home-hero-heading"
              className="text-4xl md:text-6xl lg:text-7xl font-serif font-light leading-[1.1] text-ink"
            >
              Can you distinguish the <em className="font-normal text-seal-red">soul</em> from the{' '}
              <em className="font-normal text-binding-blue">synthesis</em>?
            </h2>

            <p
              id="home-hero-description"
              className="text-lg md:text-xl text-pencil font-body italic max-w-lg mx-auto leading-relaxed"
            >
              A blind taste test for the literary mind. One poem by a human master, one by a
              machine.
            </p>
          </div>

          {/* Card */}
          <div
            id="home-featured-duel-card"
            className="mx-auto w-full max-w-md bg-stock p-1 paper-shadow rounded-sm transform transition-transform hover:-translate-y-1 duration-500"
          >
            <div
              id="home-featured-duel-card-body"
              className="border border-pencil/30 border-dashed p-10 bg-paper flex flex-col items-center gap-8"
            >
              {loading ? (
                <div
                  id="home-featured-duel-loading"
                  className="w-full max-w-xs text-center space-y-5 animate-[fadeIn_0.35s_ease-out_forwards]"
                >
                  <div className="flex justify-center">
                    <div
                      id="home-featured-duel-spinner"
                      className="w-10 h-10 rounded-full border-2 border-stock border-t-seal-red animate-spin motion-reduce:animate-none"
                      role="status"
                      aria-label="Loading"
                    />
                  </div>

                  <p
                    id="home-featured-duel-loading-status"
                    className="font-body text-sm italic text-pencil transition-opacity duration-300"
                  >
                    {retryCount > 0
                      ? `Reconnecting to archive (${retryCount}/${COLD_START_RETRY_DELAYS_MS.length})…`
                      : `${STATUS_MESSAGES[statusIndex]}…`}
                  </p>

                  {retryCount > 0 && (
                    <div
                      id="home-featured-duel-retry-progress"
                      className="flex justify-center gap-1.5"
                    >
                      {COLD_START_RETRY_DELAYS_MS.map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                            i < retryCount ? 'bg-seal-red' : 'bg-stock'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : loadError ? (
                <div
                  id="home-featured-duel-unavailable"
                  className="w-full max-w-sm text-center space-y-5 animate-[fadeIn_0.35s_ease-out_forwards]"
                >
                  <p
                    id="home-featured-duel-unavailable-copy"
                    className="font-serif text-pencil italic"
                  >
                    {loadError}
                  </p>
                  <Button id="home-featured-duel-retry-btn" onClick={handleRetry}>
                    Retry
                  </Button>
                </div>
              ) : featuredDuel ? (
                <>
                  <div id="home-featured-topic" className="text-center space-y-2">
                    <span
                      id="home-featured-topic-label"
                      className="font-sans text-[10px] tracking-widest uppercase text-pencil block"
                    >
                      Featured Topic
                    </span>
                    <h3
                      id="home-featured-topic-title"
                      className="text-3xl font-bold font-serif text-ink italic"
                    >
                      {featuredDuel.topicMeta.label}
                    </h3>
                  </div>

                  <Button id="home-enter-ring-btn" onClick={handleStart} className="group">
                    <span className="mr-2">Enter Reading Room</span>
                    <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">
                      arrow_forward
                    </span>
                  </Button>
                </>
              ) : (
                <p id="home-featured-duel-empty" className="font-serif text-pencil italic">
                  No duels available yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {appVersion !== null && (
          <p
            id="home-version-indicator"
            className="font-sans text-xs text-pencil/40 mt-8 select-none"
          >
            v{appVersion}
          </p>
        )}
      </div>
    </div>
  );
};
