import React, { useState, useEffect } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';
import { api, type DuelListItem } from '../lib/api';

interface HomeProps {
  onNavigate: (view: ViewState, duelId?: string) => void;
}

export const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [featuredDuel, setFeaturedDuel] = useState<DuelListItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDuels()
      .then((duels) => {
        if (duels.length > 0) setFeaturedDuel(duels[0]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleStart = () => {
    if (!featuredDuel) return;
    setIsExiting(true);
    setTimeout(() => {
      onNavigate(ViewState.THE_RING, featuredDuel.id);
    }, 600); // Match CSS transition
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
                <p
                  id="home-featured-duel-loading"
                  className="font-sans text-xs tracking-widest uppercase text-pencil animate-pulse"
                >
                  Loading...
                </p>
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
                    <span className="mr-2">Enter the Ring</span>
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
      </div>
    </div>
  );
};
