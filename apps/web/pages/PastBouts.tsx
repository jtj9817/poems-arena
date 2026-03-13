import React, { useState, useEffect } from 'react';
import { ViewState, type DuelListItem, type TopicMeta } from '@sanctuary/shared';
import { api } from '../lib/api';
import { TopicBar } from '../components/TopicBar';
import { BottomSheetFilter } from '../components/BottomSheetFilter';

interface PastBoutsProps {
  onNavigate: (view: ViewState, duelId?: string) => void;
}

export const PastBouts: React.FC<PastBoutsProps> = ({ onNavigate }) => {
  const [duels, setDuels] = useState<DuelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    api.getTopics().then(setTopics);
  }, []);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    api
      .getDuels(1, activeTopicId ?? undefined, undefined, 'recent')
      .then((nextDuels) => {
        if (!isCurrent) return;
        setDuels(nextDuels);
      })
      .finally(() => {
        if (!isCurrent) return;
        setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [activeTopicId]);

  const activeLabel =
    activeTopicId === null ? 'All' : (topics.find((t) => t.id === activeTopicId)?.label ?? 'All');

  return (
    <div id="past-bouts-page" className="h-full w-full overflow-y-auto no-scrollbar bg-paper">
      <div
        id="past-bouts-content"
        className="max-w-7xl mx-auto px-6 py-12 flex flex-col min-h-full"
      >
        {/* Header */}
        <header id="past-bouts-header" className="text-center mb-16 max-w-2xl mx-auto">
          <span className="material-symbols-outlined text-4xl text-pencil/40 mb-4">
            auto_stories
          </span>
          <h2
            id="past-bouts-heading"
            className="text-5xl md:text-6xl font-serif font-bold text-ink tracking-tight italic"
          >
            Past Bouts
          </h2>

          <p id="past-bouts-description" className="text-xl text-ink/70 italic font-body">
            Browse every matchup. See where readers picked the human, and where the machine fooled
            them.
          </p>
        </header>

        {/* Topic Bar — desktop (md+) */}
        <div
          id="past-bouts-topicbar-desktop"
          className="hidden md:block sticky top-0 z-30 bg-paper/95 backdrop-blur-sm py-4 mb-10 border-b border-stock"
        >
          <TopicBar
            idPrefix="past-bouts-topicbar"
            topics={topics}
            activeTopicId={activeTopicId}
            onSelect={setActiveTopicId}
          />
        </div>

        {/* Filter trigger — mobile */}
        <div
          id="past-bouts-topic-filter-mobile"
          className="flex md:hidden sticky top-0 z-30 bg-paper/95 backdrop-blur-sm py-3 mb-8 border-b border-stock justify-between items-center"
        >
          <span
            id="past-bouts-topic-filter-label"
            className="text-xs font-sans font-medium uppercase tracking-widest text-pencil"
          >
            Topic: <span className="text-ink">{activeLabel}</span>
          </span>
          <button
            id="past-bouts-filter-open-btn"
            onClick={() => setIsFilterOpen(true)}
            className="flex items-center gap-1.5 text-xs font-sans font-medium text-ink border border-border-pencil px-3 py-1.5 rounded-full"
          >
            <span className="material-symbols-outlined text-base">tune</span>
            Filter
          </button>
        </div>

        {/* Grid */}
        {loading ? (
          <div id="past-bouts-loading-state" className="flex justify-center py-20">
            <p
              id="past-bouts-loading-text"
              className="font-sans text-xs tracking-widest uppercase text-pencil animate-pulse"
            >
              Loading...
            </p>
          </div>
        ) : (
          <div
            id="past-bouts-duels-grid"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20"
          >
            {duels.map((duel) => (
              <div
                key={duel.id}
                id={`past-bouts-duel-card-${duel.id}`}
                onClick={() => onNavigate(ViewState.THE_RING, duel.id)}
                className="group cursor-pointer break-inside-avoid relative bg-paper border border-border-pencil p-8 rounded-sm hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
              >
                <div
                  id={`past-bouts-duel-card-meta-${duel.id}`}
                  className="flex justify-between items-start mb-4"
                >
                  <span
                    id={`past-bouts-duel-topic-${duel.id}`}
                    className="text-xs font-bold font-sans tracking-widest uppercase text-seal-red"
                  >
                    {duel.topicMeta.label}
                  </span>
                  <span
                    id={`past-bouts-duel-date-${duel.id}`}
                    className="text-xs font-medium font-sans text-pencil"
                  >
                    {new Date(duel.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <h3
                  id={`past-bouts-duel-title-${duel.id}`}
                  className="text-3xl font-serif font-bold text-ink mb-2 group-hover:text-seal-red transition-colors"
                >
                  On {duel.topicMeta.label}
                </h3>

                <div
                  id={`past-bouts-duel-divider-${duel.id}`}
                  className="h-px w-8 bg-pencil/20 my-4"
                ></div>

                <div
                  id={`past-bouts-duel-stats-${duel.id}`}
                  className="flex items-center justify-between mt-6 pt-4 border-t border-stock"
                >
                  <div
                    id={`past-bouts-duel-human-rate-${duel.id}`}
                    className="flex items-center gap-1.5 text-ink"
                  >
                    <span
                      className={`material-symbols-outlined text-lg ${duel.humanWinRate > 50 ? 'text-seal-red' : 'text-pencil'}`}
                    >
                      {duel.humanWinRate > 50 ? 'check_circle' : 'cancel'}
                    </span>
                    <span className="text-sm font-sans font-medium text-ink/70">
                      Human Win Rate: {duel.humanWinRate}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mobile bottom sheet */}
      <BottomSheetFilter
        idPrefix="past-bouts-mobile-filter"
        topics={topics}
        activeTopicId={activeTopicId}
        onSelect={setActiveTopicId}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
      />
    </div>
  );
};
