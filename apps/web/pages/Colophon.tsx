import React from 'react';
import { ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';

interface ColophonProps {
  onNavigate: (view: ViewState) => void;
}

export const Colophon: React.FC<ColophonProps> = ({ onNavigate }) => {
  return (
    <div className="h-full overflow-y-auto no-scrollbar w-full">
      <div className="flex flex-col items-center py-16 px-6 min-h-full">
        <article className="max-w-[640px] w-full flex flex-col gap-12">
          <header className="text-center space-y-4 mb-8">
            <div className="inline-flex items-center justify-center size-12 rounded-full bg-stock border border-ink/10 mb-2">
              <span className="material-symbols-outlined text-ink/70">stylus_note</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-serif font-bold text-ink tracking-tight italic">
              The Colophon
            </h1>
            <p className="text-seal-red font-sans font-medium tracking-widest text-xs uppercase pt-2 border-t border-ink/10 inline-block px-4 mt-4">
              Est. 2024 • Vol. I
            </p>
          </header>

          <section className="font-body text-xl text-ink/90 leading-relaxed text-justify">
            <p className="first-letter:float-left first-letter:text-6xl first-letter:font-bold first-letter:text-seal-red first-letter:mr-3 first-letter:-mt-2">
              We believe poetry is the final fortress of human subjectivity. In an age where the
              algorithm mimics the artisan, the distinction between a soul's cry and a statistical
              prediction becomes dangerously thin.
            </p>
            <p className="mt-6">
              Classicist's Sanctuary was born not from a rejection of technology, but from a
              curiosity about its limits. Can the machine truly capture the "sublime"—that ineffable
              quality that connects a poet to their reader across centuries? Or does it merely
              rearrange the shadows of what has already been said?
            </p>
          </section>

          <div className="flex items-center justify-center gap-4 py-4 opacity-40">
            <div className="h-px bg-ink w-16"></div>
            <span className="material-symbols-outlined text-sm">history_edu</span>
            <div className="h-px bg-ink w-16"></div>
          </div>

          <section className="space-y-6">
            <h2 className="text-2xl font-serif font-bold text-ink border-l-4 border-seal-red pl-4">
              The Methodology
            </h2>

            <div className="bg-stock/50 p-6 rounded-sm border border-border-pencil">
              <p className="text-lg font-serif font-bold text-ink mb-2">The Control (Human)</p>
              <p className="text-ink/80 font-body leading-relaxed">
                Selections are curated from the public domain or licensed contemporary works,
                focusing on lesser-known pieces by established masters to prevent recognition by
                rote memory.
              </p>
            </div>

            <div className="bg-stock/50 p-6 rounded-sm border border-border-pencil">
              <p className="text-lg font-serif font-bold text-ink mb-2">The Variable (Machine)</p>
              <p className="text-ink/80 font-body leading-relaxed mb-4">
                AI poems are generated zero-shot using state-of-the-art Large Language Models. No
                cherry-picking is performed. We use a standardized prompt structure to ensure
                fairness:
              </p>
              <div className="pl-4 border-l-2 border-binding-blue/40 italic text-ink/90 font-medium my-4 py-1 bg-paper p-4 text-sm font-serif">
                "Write a poem about [Topic] in the style of a contemporary master, focusing on
                sensory details and avoiding archaic rhyme schemes. Do not mention the topic
                explicitly in the title."
              </div>
            </div>
          </section>

          <div className="pt-8 mt-4 border-t border-stock flex justify-center">
            <Button variant="ghost" onClick={() => onNavigate(ViewState.FOYER)}>
              Return to Foyer
            </Button>
          </div>
        </article>
      </div>
    </div>
  );
};
