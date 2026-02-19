# Classicist's Sanctuary

## Product Overview

**The Pitch:** A "blind taste test" for the literary soul. Users compare two anonymous poems on a shared topic—one written by a celebrated human poet, the other by an advanced AI—to determine if the human spark is distinguishable from the algorithmic mirror.

**For:** Poetry aficionados, literary skeptics, and the intellectually curious who value text over tech.

**Device:** Desktop (primary), Tablet (secondary)

**Design Direction:** **Digital Letterpress.** A quiet, contemplative environment mimicking high-quality print stock. Warm, tactile beige backgrounds, deep ink-like text, and generous negative space. Zero "tech" signifiers like bright blues or gradients.

**Inspired by:** _The Paris Review_, _Poets.org_, _Lapham's Quarterly_

---

## Screens

- **The Foyer (Home):** Minimalist landing introducing the premise with a single featured "duel" entry point.
- **The Reading Room (Duel Interface):** The core split-screen comparison view, fully anonymous.
- **The Verdict (Reveal):** Post-vote state revealing authors, displaying global statistics, and offering analysis.
- **The Anthology (Archive):** Grid view of past comparisons filtered by topic (Nature, Mortality, Love).
- **The Colophon (About):** Philosophy of the project and methodology explanation.

---

## Key Flows

**The Blind Test:** Users engage with the core loop without bias.

1.  User enters **The Reading Room** -> sees two side-by-side poems titled only "A" and "B" under the topic "Winter."
2.  User reads both -> clicks subtle "Prefer Poem A" quill icon below the text.
3.  **The Verdict** triggers -> Overlay fades out, revealing Poem A is "AI (GPT-4)" and Poem B is "Robert Frost."
4.  Community stats appear (e.g., "62% of readers were fooled").

---

<details>
<summary>Design System</summary>

## Color Palette

- **Primary:** `#2C2925` - Deep Charcoal (Ink). Used for body text and primary actions.
- **Background:** `#F4F1EA` - Warm Alabaster (Paper). The main canvas.
- **Surface:** `#EBE7DE` - Darker Beige (Heavy Stock). Used for cards/containers.
- **Text:** `#2C2925` - Same as primary. High contrast but softer than pure black.
- **Muted:** `#8C8781` - Warm Grey (Pencil). Metadata, dividers, secondary text.
- **Accent:** `#9E3E36` - Oxide Red (Seal). Used sparingly for "Human" reveal and active states.
- **Secondary Accent:** `#3A5A6D` - Slate Blue (Binding). Used for "AI" reveal.

## Typography

Fonts must feel historical and authoritative. No system sans-serifs.

- **Headings:** _Piazzolla_, 700/800, 32-48px. A serif with personality and high stroke contrast.
- **Body:** _EB Garamond_, 400/500, 18px-21px. The gold standard for readability in a literary context.
- **Small text:** _Libre Franklin_, 400, 12px. A humanist sans for UI labels only (stats, dates), kept minimal.
- **Buttons:** _Piazzolla_, 600, 16px. Letter-spaced caps.

**Style notes:**

- **Paper texture:** CSS noise overlay at 2% opacity over the background.
- **Borders:** 1px solid `#D6D1C9` (faint pencil lines).
- **Shadows:** None. Use border and spacing to define hierarchy. Flat, print-like aesthetic.

## Design Tokens

```css
:root {
  --color-ink: #2c2925;
  --color-paper: #f4f1ea;
  --color-stock: #ebe7de;
  --color-seal-red: #9e3e36;
  --color-binding-blue: #3a5a6d;
  --font-serif: 'Piazzolla', serif;
  --font-body: 'EB Garamond', serif;
  --radius-sm: 2px; /* Sharp, book-like corners */
  --radius-md: 4px;
  --spacing-unit: 8px;
  --measure-wide: 680px; /* Optimal reading width */
}
```

</details>

---

<details>
<summary>Screen Specifications</summary>

### The Foyer (Home)

**Purpose:** Set the mood and funnel user immediately into a comparison.

**Layout:** Centered single-column. Massive whitespace.

**Key Elements:**

- **Hero:** "Can you distinguish the soul from the synthesis?" centered, _Piazzolla_ 48px.
- **Daily Duel Card:** A single card in the center.
  - Top label: "Today's Topic: Melancholy"
  - Action: "Enter the Reading Room" button.
- **Nav:** Minimal header (logo left, "Archive" right). No sticky headers.

**States:**

- **Default:** Clean, static.
- **Hover:** Button border darkens from `#D6D1C9` to `#2C2925`.

**Interactions:**

- **Click Start:** Smooth fade transition to Reading Room.

---

### The Reading Room (Duel Interface)

**Purpose:** The distraction-free reading and voting environment.

**Layout:** Split screen (50/50). Vertical divider line.

**Key Elements:**

- **Topic Header:** Small, centered at top. "Subject: The Ocean".
- **Poem Container A (Left) & B (Right):**
  - **Padding:** 64px internal padding.
  - **Typography:** _EB Garamond_ 20px, 1.6 line-height. Left-aligned.
  - **Scroll:** Independent scrolling if poems are long (hide scrollbars visually).
- **Voting Footer:** Sticky bottom bar (or inline at bottom of poems).
  - **Buttons:** Two identical "Select This Work" buttons using outline style.
  - **Visuals:** A small quill icon next to the text.

**States:**

- **Unvoted:** Authors are hidden. No metadata shown.
- **Selected:** Clicking a side highlights that column instantly before transitioning to Reveal.

**Responsive:**

- **Desktop:** Side-by-side.
- **Mobile:** Stacked vertically (A then B).

---

### The Verdict (Reveal)

**Purpose:** The payoff. Reveal the truth and data.

**Layout:** Same split screen structure, but UI elements transform.

**Key Elements:**

- **Author Reveal:**
  - Above Poem A: "HUMAN: Emily Dickinson" (in Oxide Red).
  - Above Poem B: "AI: Claude 3 Opus" (in Slate Blue).
- **Vote Result:**
  - Overlay message: "You chose the Machine." or "You recognized the Human."
- **Stats Bar:** Located between the poems or below titles.
  - "68% of readers chose Human."
  - "Average reading time: 4m 12s."
- **Next Duel:** "Next Topic: Mortality" button at bottom right.

**Components:**

- **Identity Badge:** Small pill tag, all caps, tracking 2px.

**Interactions:**

- **On Load:** Animate the "Human/AI" labels fading in slowly (1s duration) for dramatic effect.

---

### The Anthology (Archive)

**Purpose:** Browse past comparisons by topic.

**Layout:** 3-column masonry grid.

**Key Elements:**

- **Filter Bar:** Simple text links: "All", "Nature", "Love", "Death", "Time".
- **Archive Card:**
  - **Title:** "On [Topic]"
  - **Subtitle:** "[Human Poet] vs [AI Model]"
  - **Stat:** "Human Win Rate: 45%"
  - **Visual:** Plain beige background, thin border. No images.

**States:**

- **Empty:** "No duels recorded in this category."

**Interactions:**

- **Hover Card:** Slight Y-axis lift (-2px), border color darkens.

---

### The Colophon (About)

**Purpose:** Establish credibility and explain methodology.

**Layout:** Single column text layout, narrow measure (600px).

**Key Elements:**

- **Manifesto:** "We believe poetry is the final fortress of human subjectivity..."
- **Methodology:** "AI poems are generated zero-shot with the prompt: 'Write a poem about [Topic] in the style of a contemporary master, without rhyming unnecessarily.'"
- **Credits:** "Curated by [Name/Organization]."

</details>

---

<details>
<summary>Build Guide</summary>

**Stack:** HTML + Tailwind CSS v3

**Build Order:**

1.  **The Reading Room:** This is the MVP. Nail the typography (Garamond/Piazzolla sizing), the split-screen responsiveness, and the "paper" texture feel. If reading isn't pleasant, the app fails.
2.  **The Verdict:** Implement the logic for revealing the hidden state and styling the stats.
3.  **The Foyer:** Build the entry funnel.
4.  **The Anthology:** Add the grid view once multiple poems exist in the database.

**Tailwind Config Specifics:**

- Extend `fontFamily` to include webfont imports.
- Add custom colors to `theme.extend.colors`.
- Create a custom utility `.paper-texture` for the background noise.

</details>
