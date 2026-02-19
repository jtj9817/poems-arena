import React, { useState } from 'react';
import { ViewState } from '@sanctuary/shared';
import { Layout } from './components/Layout';
import { Foyer } from './pages/Foyer';
import { ReadingRoom } from './pages/ReadingRoom';
import { Anthology } from './pages/Anthology';
import { Colophon } from './pages/Colophon';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(ViewState.FOYER);

  const renderView = () => {
    switch (view) {
      case ViewState.FOYER:
        return <Foyer onNavigate={setView} />;
      case ViewState.READING_ROOM:
        return <ReadingRoom onNavigate={setView} />;
      case ViewState.ANTHOLOGY:
        return <Anthology onNavigate={setView} />;
      case ViewState.COLOPHON:
        return <Colophon onNavigate={setView} />;
      default:
        return <Foyer onNavigate={setView} />;
    }
  };

  return (
    <Layout currentView={view} onNavigate={setView}>
      {renderView()}
    </Layout>
  );
};

export default App;
