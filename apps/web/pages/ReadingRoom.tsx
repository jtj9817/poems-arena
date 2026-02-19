import React, { useState, useEffect } from 'react';
import { AuthorType, ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';
import { api, type AnonymousDuel, type DuelStats } from '../lib/api';

interface ReadingRoomProps {
  onNavigate: (view: ViewState) => void;
}

export const ReadingRoom: React.FC<ReadingRoomProps> = ({ onNavigate }) => {
  const [duel, setDuel] = useState<AnonymousDuel | null>(null);
  const [stats, setStats] = useState<DuelStats | null>(null);
  const [selectedPoemId, setSelectedPoemId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTodaysDuel()
      .then((d) => {
        setDuel(d);
        setTimeout(() => setFadeIn(true), 100);
      })
      .catch(() => setError("Could not load today's duel. Please try again."));
  }, []);

  const handleVote = async (poemId: string) => {
    if (!duel) return;
    setSelectedPoemId(poemId);
    try {
      await api.vote(duel.id, poemId);
      const duelStats = await api.getDuelStats(duel.id);
      setStats(duelStats);
    } catch {
      // Show reveal anyway with no stats
    }
    setRevealed(true);
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

  const selectedPoem = stats?.duel
    ? selectedPoemId === stats.duel.poemA.id
      ? stats.duel.poemA
      : stats.duel.poemB
    : null;

  const isHumanWinner = revealed && selectedPoem && selectedPoem.type === AuthorType.HUMAN;

  const verdictMessage = isHumanWinner ? 'You recognized the Human.' : 'You chose the Machine.';

  return (
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

        {/* Verdict Overlay */}
        {revealed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4">
            <div className="bg-paper paper-shadow border border-ink p-8 md:p-12 max-w-xl w-full text-center animate-[fadeIn_1s_ease-out_forwards] pointer-events-auto">
              <p className="font-sans text-xs tracking-[0.2em] uppercase text-pencil mb-4">
                The Verdict
              </p>
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
                <Button variant="ghost" onClick={() => setRevealed(false)}>
                  Review Poems
                </Button>
                <Button onClick={() => onNavigate(ViewState.ANTHOLOGY)}>Next Duel</Button>
              </div>
            </div>
          </div>
        )}

        {/* Poem A */}
        <PoemColumn
          poem={duel.poemA}
          revealedPoem={stats?.duel.poemA ?? null}
          label="Exhibit A"
          revealed={revealed}
          isSelected={selectedPoemId === duel.poemA.id}
          onSelect={() => handleVote(duel.poemA.id)}
          disabled={revealed}
          isLeft={true}
        />

        {/* Poem B */}
        <PoemColumn
          poem={duel.poemB}
          revealedPoem={stats?.duel.poemB ?? null}
          label="Exhibit B"
          revealed={revealed}
          isSelected={selectedPoemId === duel.poemB.id}
          onSelect={() => handleVote(duel.poemB.id)}
          disabled={revealed}
        />
      </div>
    </div>
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
