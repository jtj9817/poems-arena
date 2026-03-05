import React from 'react';
import { AuthorType } from '@sanctuary/shared';
import { Button } from './Button';
import { SourceInfo } from './SourceInfo';
import type { DuelStats } from '../lib/api';

interface VerdictPopupProps {
  isOpen: boolean;
  selectedPoemId: string | null;
  stats: DuelStats | null;
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

  return (
    <div
      id={`${popupIdPrefix}-backdrop`}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(44, 41, 37, 0.6)' }}
      data-animation-state="open"
    >
      <div
        id={`${popupIdPrefix}-dialog`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${popupIdPrefix}-heading`}
        className="bg-paper paper-shadow border border-ink p-8 md:p-12 max-w-xl w-full text-center animate-[verdictIn_0.4s_ease-out_forwards]"
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
            className="grid grid-cols-2 gap-6 mb-6 pt-4 border-t border-stock"
          >
            <SourceInfo
              idPrefix={`${popupIdPrefix}-poem-a-source`}
              author={stats.duel.poemA.author}
              type={stats.duel.poemA.type}
              year={stats.duel.poemA.year}
              sourceInfo={stats.duel.poemA.sourceInfo}
            />
            <SourceInfo
              idPrefix={`${popupIdPrefix}-poem-b-source`}
              author={stats.duel.poemB.author}
              type={stats.duel.poemB.type}
              year={stats.duel.poemB.year}
              sourceInfo={stats.duel.poemB.sourceInfo}
            />
          </div>
        )}

        {stats && (
          <div
            id={`${popupIdPrefix}-stats`}
            className="flex justify-center gap-8 mb-8 font-sans text-xs tracking-wider border-y border-stock py-4"
          >
            <div id={`${popupIdPrefix}-human-rate`} className="text-center">
              <span
                id={`${popupIdPrefix}-human-rate-value`}
                className="block text-xl font-serif font-bold text-ink"
              >
                {stats.humanWinRate}%
              </span>
              <span id={`${popupIdPrefix}-human-rate-label`} className="text-pencil">
                Recog. Human
              </span>
            </div>
            <div id={`${popupIdPrefix}-avg-read-time`} className="text-center">
              <span
                id={`${popupIdPrefix}-avg-read-time-value`}
                className="block text-xl font-serif font-bold text-ink"
              >
                {stats.avgReadingTime}
              </span>
              <span id={`${popupIdPrefix}-avg-read-time-label`} className="text-pencil">
                Avg. Read Time
              </span>
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
