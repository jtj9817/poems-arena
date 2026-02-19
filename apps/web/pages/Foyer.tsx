import React, { useState } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Button } from '../components/Button';

interface FoyerProps {
  onNavigate: (view: ViewState) => void;
}

export const Foyer: React.FC<FoyerProps> = ({ onNavigate }) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleStart = () => {
    setIsExiting(true);
    setTimeout(() => {
      onNavigate(ViewState.READING_ROOM);
    }, 600); // Match CSS transition
  };

  return (
    <div className={`h-full w-full overflow-y-auto no-scrollbar flex items-center justify-center`}>
      <div
        className={`flex-grow flex flex-col items-center justify-center px-6 py-12 transition-opacity duration-700 ${isExiting ? 'opacity-0 translate-y-4' : 'opacity-100'}`}
      >
        <div className="max-w-3xl text-center space-y-12">
          <div className="space-y-6">
            <div className="inline-block border-b border-seal-red/30 pb-1">
              <span className="font-sans text-xs tracking-[0.2em] uppercase font-medium text-seal-red">
                Daily Challenge
              </span>
            </div>

            <h2 className="text-4xl md:text-6xl lg:text-7xl font-serif font-light leading-[1.1] text-ink">
              Can you distinguish the <em className="font-normal text-seal-red">soul</em> from the{' '}
              <em className="font-normal text-binding-blue">synthesis</em>?
            </h2>

            <p className="text-lg md:text-xl text-pencil font-body italic max-w-lg mx-auto leading-relaxed">
              A blind taste test for the literary mind. One poem by a human master, one by a
              machine.
            </p>
          </div>

          {/* Card */}
          <div className="mx-auto w-full max-w-md bg-stock p-1 paper-shadow rounded-sm transform transition-transform hover:-translate-y-1 duration-500">
            <div className="border border-pencil/30 border-dashed p-10 bg-paper flex flex-col items-center gap-8">
              <div className="text-center space-y-2">
                <span className="font-sans text-[10px] tracking-widest uppercase text-pencil block">
                  Today's Topic
                </span>
                <h3 className="text-3xl font-bold font-serif text-ink italic">Melancholy</h3>
              </div>

              <Button onClick={handleStart} className="group">
                <span className="mr-2">Enter Reading Room</span>
                <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">
                  arrow_forward
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
