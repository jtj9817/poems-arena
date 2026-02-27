import React from 'react';
import { AuthorType } from '@sanctuary/shared';
import { Button } from './Button';
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(44, 41, 37, 0.6)' }}
    >
      <div className="bg-paper paper-shadow border border-ink p-8 md:p-12 max-w-xl w-full text-center animate-[verdictIn_0.4s_ease-out_forwards]">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-pencil mb-4">The Verdict</p>
        <h2 className="text-4xl md:text-5xl font-serif text-ink mb-6">{verdictMessage}</h2>

        {stats && (
          <div className="flex justify-center gap-8 mb-8 font-sans text-xs tracking-wider border-y border-stock py-4">
            <div className="text-center">
              <span className="block text-xl font-serif font-bold text-ink">
                {stats.humanWinRate}%
              </span>
              <span className="text-pencil">Recog. Human</span>
            </div>
            <div className="text-center">
              <span className="block text-xl font-serif font-bold text-ink">
                {stats.avgReadingTime}
              </span>
              <span className="text-pencil">Avg. Read Time</span>
            </div>
          </div>
        )}

        <div className="flex gap-4 justify-center">
          <Button variant="ghost" onClick={onReviewPoems}>
            Review Poems
          </Button>
          <Button onClick={onContinue}>Next Duel</Button>
        </div>
      </div>
    </div>
  );
};
