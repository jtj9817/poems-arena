import React, { useState } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Layout } from './components/Layout';
import { Foyer } from './pages/Foyer';
import { ReadingRoom } from './pages/ReadingRoom';
import { Anthology } from './pages/Anthology';
import { Colophon } from './pages/Colophon';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(ViewState.FOYER);
  const [activeDuelId, setActiveDuelId] = useState<string | null>(null);

  const navigate = (newView: ViewState, duelId?: string | null) => {
    if (duelId !== undefined) setActiveDuelId(duelId);
    setView(newView);
  };

  const renderView = () => {
    switch (view) {
      case ViewState.FOYER:
        return <Foyer onNavigate={navigate} />;
      case ViewState.READING_ROOM:
        return (
          <ReadingRoom
            key={activeDuelId || 'fallback'}
            duelId={activeDuelId}
            onNavigate={navigate}
          />
        );
      case ViewState.ANTHOLOGY:
        return <Anthology onNavigate={navigate} />;
      case ViewState.COLOPHON:
        return <Colophon onNavigate={navigate} />;
      default:
        return <Foyer onNavigate={navigate} />;
    }
  };

  return (
    <Layout currentView={view} onNavigate={navigate}>
      {renderView()}
    </Layout>
  );
};

export default App;
