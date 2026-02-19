import React, { useState, useEffect } from 'react';
import { Duel, AuthorType, ViewState } from '../types';
import { Button } from '../components/Button';
import { DUELS } from '../data/poems';

interface ReadingRoomProps {
  onNavigate: (view: ViewState) => void;
}

export const ReadingRoom: React.FC<ReadingRoomProps> = ({ onNavigate }) => {
  const [duel, setDuel] = useState<Duel | null>(null);
  const [selectedPoemId, setSelectedPoemId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  useEffect(() => {
    // Simulate loading data
    setDuel(DUELS[0]);
    setTimeout(() => setFadeIn(true), 100);
  }, []);

  const handleVote = (poemId: string) => {
    setSelectedPoemId(poemId);
    setRevealed(true);
  };

  if (!duel) return <div className="flex-grow flex items-center justify-center">Loading...</div>;

  const isHumanWinner = revealed && selectedPoemId && (
    (selectedPoemId === duel.poemA.id && duel.poemA.type === AuthorType.HUMAN) ||
    (selectedPoemId === duel.poemB.id && duel.poemB.type === AuthorType.HUMAN)
  );

  const verdictMessage = isHumanWinner 
    ? "You recognized the Human." 
    : "You chose the Machine.";

  return (
    <div className={`flex-grow flex flex-col w-full transition-opacity duration-1000 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}>
      
      {/* Header Info */}
      <div className="w-full text-center py-6 border-b border-stock/30">
        <p className="font-sans text-xs tracking-[0.2em] uppercase text-pencil">Subject</p>
        <p className="font-serif text-2xl italic text-ink mt-1">{duel.topic}</p>
      </div>

      {/* Split Screen */}
      <div className="flex-grow flex flex-col lg:flex-row relative">
        
        {/* Divider (Desktop) */}
        <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-border-pencil z-10"></div>

        {/* Verdict Overlay (Absolute center) */}
        {revealed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4">
             <div className="bg-paper paper-shadow border border-ink p-8 md:p-12 max-w-xl w-full text-center animate-[fadeIn_1s_ease-out_forwards] pointer-events-auto">
                <p className="font-sans text-xs tracking-[0.2em] uppercase text-pencil mb-4">The Verdict</p>
                <h2 className="text-4xl md:text-5xl font-serif text-ink mb-6">
                  {verdictMessage}
                </h2>
                <div className="flex justify-center gap-8 mb-8 font-sans text-xs tracking-wider border-y border-stock py-4">
                   <div className="text-center">
                      <span className="block text-xl font-serif font-bold text-ink">{duel.humanWinRate}%</span>
                      <span className="text-pencil">Recog. Human</span>
                   </div>
                   <div className="text-center">
                      <span className="block text-xl font-serif font-bold text-ink">{duel.avgReadingTime}</span>
                      <span className="text-pencil">Avg. Read Time</span>
                   </div>
                </div>
                <div className="flex gap-4 justify-center">
                  <Button variant="ghost" onClick={() => setRevealed(false)}>
                    Review Poems
                  </Button>
                  <Button onClick={() => onNavigate(ViewState.ANTHOLOGY)}>
                    Next Duel
                  </Button>
                </div>
             </div>
          </div>
        )}

        {/* Poem A */}
        <PoemColumn 
          poem={duel.poemA} 
          label="Exhibit A" 
          revealed={revealed} 
          isSelected={selectedPoemId === duel.poemA.id}
          onSelect={() => handleVote(duel.poemA.id)}
          disabled={revealed}
        />

        {/* Poem B */}
        <PoemColumn 
          poem={duel.poemB} 
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
  poem: any;
  label: string;
  revealed: boolean;
  isSelected: boolean;
  onSelect: () => void;
  disabled: boolean;
}

const PoemColumn: React.FC<PoemColumnProps> = ({ poem, label, revealed, isSelected, onSelect, disabled }) => {
  const isHuman = poem.type === AuthorType.HUMAN;
  const authorColor = isHuman ? 'text-seal-red' : 'text-binding-blue';
  const labelText = isHuman ? 'Human' : 'Artificial Intelligence';

  return (
    <div className={`flex-1 flex flex-col p-8 md:p-16 lg:p-20 relative transition-colors duration-700 ${revealed && isSelected ? 'bg-stock/30' : ''}`}>
      
      {/* Reveal Header */}
      <div className={`text-center mb-12 h-20 flex flex-col justify-end transition-opacity duration-700 ${revealed ? 'opacity-100' : 'opacity-0'}`}>
        <span className={`font-sans text-[10px] uppercase tracking-[0.2em] font-bold ${authorColor} mb-2 block`}>
          {labelText}
        </span>
        <h3 className={`text-2xl font-serif font-bold italic ${authorColor}`}>
          {poem.author}
        </h3>
        <span className="text-xs font-sans text-pencil mt-1">{poem.year}</span>
      </div>

      {/* Anonymized Header (Fades out on reveal) */}
      {!revealed && (
         <div className="absolute top-16 left-0 right-0 text-center">
            <span className="inline-block border-b border-pencil/30 pb-2 px-4 font-serif font-bold text-lg tracking-widest text-pencil/60 uppercase">
              {label}
            </span>
         </div>
      )}

      {/* Poem Content */}
      <div className={`prose prose-lg mx-auto max-w-md font-body text-xl leading-relaxed whitespace-pre-line text-ink transition-all duration-700 ${revealed ? 'blur-0' : 'blur-0'}`}>
        {revealed ? (
          <div className="mb-6 text-center md:text-left">
            <p className="font-serif font-bold italic text-2xl mb-6">{poem.title}</p>
          </div>
        ) : null}
        {poem.content}
      </div>

      {/* Selection Button */}
      {!revealed && (
        <div className="mt-auto pt-16 flex justify-center sticky bottom-8">
           <Button 
            variant="outline" 
            onClick={onSelect} 
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
              <span className="text-xs font-sans font-medium uppercase tracking-wide">Your Choice</span>
           </div>
        </div>
      )}
    </div>
  );
};