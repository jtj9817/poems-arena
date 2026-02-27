import React, { useState, useEffect } from 'react';
import { ViewState, type TopicMeta } from '@sanctuary/shared';
import { api, type DuelListItem } from '../lib/api';
import { TopicBar } from '../components/TopicBar';
import { BottomSheetFilter } from '../components/BottomSheetFilter';

interface AnthologyProps {
  onNavigate: (view: ViewState, duelId?: string) => void;
}

export const Anthology: React.FC<AnthologyProps> = ({ onNavigate }) => {
  const [duels, setDuels] = useState<DuelListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    api.getTopics().then(setTopics);
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .getDuels(1, activeTopicId ?? undefined)
      .then(setDuels)
      .finally(() => setLoading(false));
  }, [activeTopicId]);

  const activeLabel =
    activeTopicId === null ? 'All' : (topics.find((t) => t.id === activeTopicId)?.label ?? 'All');

  return (
    <div className="h-full w-full overflow-y-auto no-scrollbar bg-paper">
      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col min-h-full">
        {/* Header */}
        <div className="text-center mb-16 max-w-2xl mx-auto">
          <span className="material-symbols-outlined text-4xl text-pencil/40 mb-4">
            auto_stories
          </span>
          <h2 className="text-5xl md:text-6xl font-serif font-bold mb-6 text-ink tracking-tight">
            The Anthology
          </h2>
          <p className="text-xl text-ink/70 italic font-body">
            A compendium of past skirmishes. Explore where the human spirit prevailed, and where the
            machine mirrored it too perfectly.
          </p>
        </div>

        {/* Topic Bar — desktop (md+) */}
        <div className="hidden md:block sticky top-0 z-30 bg-paper/95 backdrop-blur-sm py-4 mb-10 border-b border-stock">
          <TopicBar topics={topics} activeTopicId={activeTopicId} onSelect={setActiveTopicId} />
        </div>

        {/* Filter trigger — mobile */}
        <div className="flex md:hidden sticky top-0 z-30 bg-paper/95 backdrop-blur-sm py-3 mb-8 border-b border-stock justify-between items-center">
          <span className="text-xs font-sans font-medium uppercase tracking-widest text-pencil">
            Topic: <span className="text-ink">{activeLabel}</span>
          </span>
          <button
            onClick={() => setIsFilterOpen(true)}
            className="flex items-center gap-1.5 text-xs font-sans font-medium text-ink border border-border-pencil px-3 py-1.5 rounded-full"
          >
            <span className="material-symbols-outlined text-base">tune</span>
            Filter
          </button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <p className="font-sans text-xs tracking-widest uppercase text-pencil animate-pulse">
              Loading...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
            {duels.map((duel) => (
              <div
                key={duel.id}
                onClick={() => onNavigate(ViewState.READING_ROOM, duel.id)}
                className="group cursor-pointer break-inside-avoid relative bg-paper border border-border-pencil p-8 rounded-sm hover:-translate-y-1 hover:shadow-lg transition-all duration-300"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-bold font-sans tracking-widest uppercase text-seal-red">
                    {duel.topicMeta.label}
                  </span>
                  <span className="text-xs font-medium font-sans text-pencil">
                    {new Date(duel.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <h3 className="text-3xl font-serif font-bold text-ink mb-2 group-hover:text-seal-red transition-colors">
                  On {duel.topicMeta.label}
                </h3>

                <div className="h-px w-8 bg-pencil/20 my-4"></div>

                <div className="flex items-center justify-between mt-6 pt-4 border-t border-stock">
                  <div className="flex items-center gap-1.5 text-ink">
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
        topics={topics}
        activeTopicId={activeTopicId}
        onSelect={setActiveTopicId}
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
      />
    </div>
  );
};
