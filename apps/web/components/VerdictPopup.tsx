import React from 'react';
import { AuthorType } from '@sanctuary/shared';
import type { DuelStatsResponse } from '@sanctuary/shared';
import { Button } from './Button';
import { SourceInfo } from './SourceInfo';

interface VerdictPopupProps {
  isOpen: boolean;
  selectedPoemId: string | null;
  stats: DuelStatsResponse | null;
  onContinue: () => void;
  onReviewPoems: () => void;
}

export const VerdictPopup: React.FC<VerdictPopupProps> = ({
  isOpen,
  selectedPoemId,
  stats,
  onContinue,
  onReviewPoems,
}) => {
  if (!isOpen) return null;

  const selectedPoem = stats?.duel
    ? selectedPoemId === stats.duel.poemA.id
      ? stats.duel.poemA
      : stats.duel.poemB
    : null;

  const isHumanWinner = selectedPoem?.type === AuthorType.HUMAN;
  const verdictMessage = isHumanWinner ? 'You recognized the Human.' : 'You chose the Machine.';
  const popupIdPrefix = 'the-ring-verdict-popup';

  const topicDelta = stats && stats.topicStats.humanWinRate - stats.globalStats.humanWinRate;

  return (
    <div
      id={`${popupIdPrefix}-backdrop`}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(44, 41, 37, 0.6)' }}
      data-animation-state="open"
    >
      <div
        id={`${popupIdPrefix}-dialog`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${popupIdPrefix}-heading`}
        className="bg-paper paper-shadow border border-ink p-8 md:p-12 max-w-2xl w-full text-center my-8 animate-[verdictIn_0.4s_ease-out_forwards]"
      >
        <p
          id={`${popupIdPrefix}-kicker`}
          className="font-sans text-xs tracking-[0.2em] uppercase text-pencil mb-4"
        >
          The Verdict
        </p>
        <h2
          id={`${popupIdPrefix}-heading`}
          className="text-4xl md:text-5xl font-serif text-ink mb-6"
        >
          {verdictMessage}
        </h2>

        {/* Source attribution — revealed after vote */}
        {stats?.duel && (
          <div
            id={`${popupIdPrefix}-sources`}
            className="grid grid-cols-2 gap-6 mb-8 pt-4 border-t border-stock"
          >
            <SourceInfo
              idPrefix={`${popupIdPrefix}-poem-a-source`}
              author={stats.duel.poemA.author}
              type={stats.duel.poemA.type}
              year={stats.duel.poemA.year ?? undefined}
              sourceInfo={stats.duel.poemA.sourceInfo}
            />
            <SourceInfo
              idPrefix={`${popupIdPrefix}-poem-b-source`}
              author={stats.duel.poemB.author}
              type={stats.duel.poemB.type}
              year={stats.duel.poemB.year ?? undefined}
              sourceInfo={stats.duel.poemB.sourceInfo}
            />
          </div>
        )}

        {stats && (
          <div
            id={`${popupIdPrefix}-detailed-stats`}
            className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 border-y border-stock py-8 text-left"
          >
            {/* Recognition Rates */}
            <div id={`${popupIdPrefix}-recognition-section`}>
              <h4 className="font-sans text-[10px] uppercase tracking-[0.2em] text-pencil mb-6 border-b border-stock/30 pb-2">
                Recognition Rate
              </h4>

              {/* Global Stat */}
              <div id={`${popupIdPrefix}-global-rate`} className="mb-6">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-pencil mb-1">
                  <span>Global Average</span>
                  <span className="font-serif font-bold text-ink text-sm">
                    {stats.globalStats.humanWinRate}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-stock/50 relative">
                  <div
                    className="h-full bg-ink/30 transition-all duration-1000"
                    style={{ width: `${stats.globalStats.humanWinRate}%` }}
                  />
                </div>
              </div>

              {/* Topic Stat */}
              <div id={`${popupIdPrefix}-topic-rate`}>
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-pencil mb-1">
                  <span>Topic: {stats.topicStats.topicMeta.label}</span>
                  <span className="font-serif font-bold text-ink text-sm">
                    {stats.topicStats.humanWinRate}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-stock/50 relative">
                  <div
                    className="h-full bg-ink transition-all duration-1000"
                    style={{ width: `${stats.topicStats.humanWinRate}%` }}
                  />
                </div>
                {topicDelta !== null && (
                  <div
                    className={`text-[10px] text-right mt-1 font-medium ${topicDelta >= 0 ? 'text-seal-red' : 'text-binding-blue'}`}
                  >
                    {topicDelta >= 0 ? '↑' : '↓'} {Math.abs(topicDelta)}% vs global
                  </div>
                )}
              </div>
            </div>

            {/* Decision Times */}
            <div id={`${popupIdPrefix}-timing-section`}>
              <h4 className="font-sans text-[10px] uppercase tracking-[0.2em] text-pencil mb-6 border-b border-stock/30 pb-2">
                Avg. Decision Time
              </h4>

              <div className="flex flex-col gap-6">
                <div
                  id={`${popupIdPrefix}-global-timing`}
                  className="flex justify-between items-baseline"
                >
                  <span className="font-sans text-[10px] uppercase tracking-widest text-pencil">
                    Global
                  </span>
                  <span className="font-serif text-2xl text-ink">
                    {stats.globalStats.avgDecisionTime ?? '—'}
                  </span>
                </div>

                <div
                  id={`${popupIdPrefix}-topic-timing`}
                  className="flex justify-between items-baseline"
                >
                  <span className="font-sans text-[10px] uppercase tracking-widest text-pencil">
                    Topic
                  </span>
                  <div className="text-right">
                    <span className="font-serif text-2xl text-ink block">
                      {stats.topicStats.avgDecisionTime ?? '—'}
                    </span>
                    <span className="font-sans text-[10px] uppercase tracking-widest text-pencil italic">
                      {stats.topicStats.topicMeta.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div id={`${popupIdPrefix}-actions`} className="flex gap-4 justify-center">
          <Button id={`${popupIdPrefix}-review-btn`} variant="ghost" onClick={onReviewPoems}>
            Review Poems
          </Button>
          <Button id={`${popupIdPrefix}-next-duel-btn`} onClick={onContinue}>
            Next Duel
          </Button>
        </div>
      </div>
    </div>
  );
};
