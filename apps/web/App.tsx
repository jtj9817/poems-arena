import React, { useState } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { TheRing } from './pages/TheRing';
import { PastBouts } from './pages/PastBouts';
import { About } from './pages/About';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(ViewState.HOME);
  const [activeDuelId, setActiveDuelId] = useState<string | null>(null);

  const navigate = (newView: ViewState, duelId?: string | null) => {
    if (duelId !== undefined) setActiveDuelId(duelId);
    setView(newView);
  };

  const renderView = () => {
    switch (view) {
      case ViewState.HOME:
        return <Home onNavigate={navigate} />;
      case ViewState.THE_RING:
        return (
          <TheRing key={activeDuelId || 'fallback'} duelId={activeDuelId} onNavigate={navigate} />
        );
      case ViewState.PAST_BOUTS:
        return <PastBouts onNavigate={navigate} />;
      case ViewState.ABOUT:
        return <About onNavigate={navigate} />;
      default:
        return <Home onNavigate={navigate} />;
    }
  };

  return (
    <Layout currentView={view} onNavigate={navigate}>
      {renderView()}
    </Layout>
  );
};

export default App;
