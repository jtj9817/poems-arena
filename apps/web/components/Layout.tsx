import React from 'react';
import { ViewState } from '@sanctuary/shared';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentView, onNavigate }) => {
  return (
    <div
      id="site-layout"
      className="h-screen flex flex-col relative w-full overflow-hidden bg-paper text-ink selection:bg-ink selection:text-paper"
    >
      {/* Noise Texture Overlay */}
      <div
        id="site-layout-noise-overlay"
        className="fixed inset-0 pointer-events-none z-50 bg-noise opacity-100 mix-blend-multiply"
      ></div>

      {/* Navigation */}
      <header
        id="site-header"
        className="w-full px-6 py-6 md:px-12 flex justify-between items-center relative z-40 border-b border-stock/50 shrink-0"
      >
        <button
          id="site-header-brand-btn"
          type="button"
          className="flex items-center gap-2 cursor-pointer group bg-transparent border-0 p-0 text-left"
          onClick={() => onNavigate(ViewState.HOME)}
        >
          <span className="material-symbols-outlined text-3xl text-ink transition-transform duration-500 group-hover:rotate-12">
            history_edu
          </span>
          <h1 className="hidden md:block text-xl font-bold tracking-tight italic font-serif text-ink">
            Poems Arena
          </h1>
        </button>

        <nav
          id="site-header-nav"
          className="flex items-center gap-6 font-sans text-xs tracking-[0.15em] uppercase font-medium text-pencil"
        >
          <button
            id="site-header-nav-past-bouts-btn"
            onClick={() => onNavigate(ViewState.PAST_BOUTS)}
            className={`hover:text-ink transition-colors ${currentView === ViewState.PAST_BOUTS ? 'text-ink underline decoration-1 underline-offset-4' : ''}`}
          >
            Past Bouts
          </button>
          <button
            id="site-header-nav-about-btn"
            onClick={() => onNavigate(ViewState.ABOUT)}
            className={`hover:text-ink transition-colors ${currentView === ViewState.ABOUT ? 'text-ink underline decoration-1 underline-offset-4' : ''}`}
          >
            About
          </button>
        </nav>
      </header>

      {/* Main Content - overflow-hidden to allow views to manage their own scroll areas (e.g. split screen) */}
      <main id="site-main" className="flex-grow flex flex-col relative z-30 overflow-hidden">
        {children}
      </main>

      {/* Footer */}
      <footer
        id="site-footer"
        className="w-full py-8 text-center relative z-30 border-t border-stock/50 shrink-0"
      >
        <p
          id="site-footer-copyright"
          className="font-sans text-[10px] tracking-widest text-pencil uppercase"
        >
          © 2026 Poems Arena
        </p>
      </footer>
    </div>
  );
};
