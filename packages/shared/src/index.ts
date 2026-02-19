export enum AuthorType {
  HUMAN = 'HUMAN',
  AI = 'AI',
}

export interface Poem {
  id: string;
  title: string; // The real title
  content: string;
  author: string; // "Emily Dickinson" or "Claude 3 Opus"
  type: AuthorType;
  year?: string;
}

export interface Duel {
  id: string;
  topic: string;
  poemA: Poem;
  poemB: Poem;
  humanWinRate: number; // Percentage 0-100
  avgReadingTime: string; // e.g., "4m 12s"
}

export enum ViewState {
  FOYER = 'FOYER',
  READING_ROOM = 'READING_ROOM',
  ANTHOLOGY = 'ANTHOLOGY',
  COLOPHON = 'COLOPHON',
}

export interface DuelResult {
  duelId: string;
  selectedPoemId: string;
  isHuman: boolean;
}
