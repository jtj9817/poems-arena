import { Duel, AuthorType } from '../types';

export const DUELS: Duel[] = [
  {
    id: 'duel-1',
    topic: 'Melancholy',
    humanWinRate: 62,
    avgReadingTime: '3m 45s',
    poemA: {
      id: 'p1',
      title: 'Ode on Melancholy',
      author: 'John Keats',
      type: AuthorType.HUMAN,
      year: '1819',
      content: `No, no, go not to Lethe, neither twist
Wolf's-bane, tight-rooted, for its poisonous wine;
Nor suffer thy pale forehead to be kiss'd
By nightshade, ruby grape of Proserpine;
Make not your rosary of yew-berries,
Nor let the beetle, nor the death-moth be
Your mournful Psyche, nor the downy owl
A partner in your sorrow's mysteries;
For shade to shade will come too drowsily,
And drown the wakeful anguish of the soul.`
    },
    poemB: {
      id: 'p2',
      title: 'The Gray Veil',
      author: 'GPT-4',
      type: AuthorType.AI,
      year: '2023',
      content: `The fog descends, a curtain drawn so tight,
Upon the stage where once the sun played host.
It is a quiet theft of warmth and light,
A silent turning of a lively ghost.
The trees stand bare, like bones of ancient kings,
Who lost their crowns to autumn's rustling thief.
No bird in this gray cathedral sings,
Save for the wind that orchestrates the grief.
It is not sharp, this ache within the chest,
But heavy, like a stone in river deep.`
    }
  },
  {
    id: 'duel-2',
    topic: 'The Ocean',
    humanWinRate: 45,
    avgReadingTime: '2m 10s',
    poemA: {
      id: 'p3',
      title: 'Tide-Borne',
      author: 'Claude 3 Opus',
      type: AuthorType.AI,
      year: '2024',
      content: `Salt stings the air, a memory of tears,
As waves rewrite the sand in endless script.
The horizon pulls the eye, confirms the fears
That we are small, by cosmic currents gripped.
Blue upon blue, a bruise that never heals,
The water heaves with breath of ancient things.
It hides the wrecks, the gold, the broken seals,
And to the moon its liquid anthem sings.`
    },
    poemB: {
      id: 'p4',
      title: 'The Sea Limits',
      author: 'Dante Gabriel Rossetti',
      type: AuthorType.HUMAN,
      year: '1849',
      content: `Consider the sea's listless chime:
Time's self it is, made audible,—
The murmur of the earth's own shell.
Secret continuance sublime
Is the sea's end: our sight may pass
No furlong further. Since time was,
This sound hath told the lapse of time.`
    }
  }
];

export const MOCK_ARCHIVE = [
  ...DUELS,
  {
    id: 'duel-3',
    topic: 'Time',
    humanWinRate: 78,
    avgReadingTime: '4m 12s',
    poemA: { title: 'Clockwork', author: 'Llama 2', type: AuthorType.AI, id: 'p5', content: '' },
    poemB: { title: 'The Hourglass', author: 'Dylan Thomas', type: AuthorType.HUMAN, id: 'p6', content: '' }
  },
  {
    id: 'duel-4',
    topic: 'Nature',
    humanWinRate: 33,
    avgReadingTime: '1m 55s',
    poemA: { title: 'The Forest Edge', author: 'Robert Frost', type: AuthorType.HUMAN, id: 'p7', content: '' },
    poemB: { title: 'Green Canopy', author: 'GPT-3.5', type: AuthorType.AI, id: 'p8', content: '' }
  }
];