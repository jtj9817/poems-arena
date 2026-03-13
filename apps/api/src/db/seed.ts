/**
 * Seed script — populates the Turso DB with initial poem/duel data.
 * Run with: bun run src/db/seed.ts
 */
import { db } from './client';
import { poems, duels, topics } from './schema';

const POEMS = [
  {
    id: 'p1',
    title: 'Ode on Melancholy',
    author: 'John Keats',
    type: 'HUMAN' as const,
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
And drown the wakeful anguish of the soul.`,
  },
  {
    id: 'p2',
    title: 'The Gray Veil',
    author: 'GPT-4',
    type: 'AI' as const,
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
But heavy, like a stone in river deep.`,
  },
  {
    id: 'p3',
    title: 'Tide-Borne',
    author: 'Claude 3 Opus',
    type: 'AI' as const,
    year: '2024',
    content: `Salt stings the air, a memory of tears,
As waves rewrite the sand in endless script.
The horizon pulls the eye, confirms the fears
That we are small, by cosmic currents gripped.
Blue upon blue, a bruise that never heals,
The water heaves with breath of ancient things.
It hides the wrecks, the gold, the broken seals,
And to the moon its liquid anthem sings.`,
  },
  {
    id: 'p4',
    title: 'The Sea Limits',
    author: 'Dante Gabriel Rossetti',
    type: 'HUMAN' as const,
    year: '1849',
    content: `Consider the sea's listless chime:
Time's self it is, made audible,—
The murmur of the earth's own shell.
Secret continuance sublime
Is the sea's end: our sight may pass
No furlong further. Since time was,
This sound hath told the lapse of time.`,
  },
];

const TOPICS = [
  { id: 'topic-melancholy', label: 'Melancholy' },
  { id: 'topic-the-ocean', label: 'The Ocean' },
];

const DUELS = [
  {
    id: 'duel-1',
    topic: 'Melancholy',
    topicId: 'topic-melancholy',
    poemAId: 'p1',
    poemBId: 'p2',
  },
  {
    id: 'duel-2',
    topic: 'The Ocean',
    topicId: 'topic-the-ocean',
    poemAId: 'p3',
    poemBId: 'p4',
  },
];

async function seed() {
  console.log('Seeding poems…');
  for (const poem of POEMS) {
    await db.insert(poems).values(poem).onConflictDoNothing();
  }

  console.log('Seeding topics…');
  for (const topic of TOPICS) {
    await db.insert(topics).values(topic).onConflictDoNothing();
  }

  console.log('Seeding duels…');
  for (const duel of DUELS) {
    await db.insert(duels).values(duel).onConflictDoNothing();
  }

  console.log('Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
