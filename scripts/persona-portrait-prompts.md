# Persona Portrait Prompts — Retro Diffusion (primary) + fallbacks

Generation spec for the 5 Hearsay persona portraits. Output drops into
`public/images/personas/{novice,reader,misdirector,silent,clerk}.png`
where `<PersonaPortrait>` + `<ClerkSprite>` auto-load them with silhouette /
SVG fallback.

**Art direction:** anthropomorphic animals in Balatro-style painterly pixel
art. Voice casting is already locked to human archetypes (nervous Londoner,
Gus-Fring prosecutor, British barrister, elderly judge, clerk) — the animal
layer sits ON TOP of that, creating productive dissonance.

---

## Tool settings (Retro Diffusion web app)

| Field | Value |
|-------|-------|
| **Model** | `RD Fast` (1 credit/gen — stretch the free 50 across iterations) |
| **Art Style** | `Portrait` (single-view, painterly, atmospheric — closest Balatro match) |
| **Size / aspect** | Closest to **2:3 vertical** (e.g. 256×384 if available) |
| **Seed** | Lock ONE random seed from the first good rat gen, reuse for all 5 — biggest consistency lever |
| **Batch size** | 1 per gen (iterate prompts, not batches) |

### Negative prompt (paste into Retro Diffusion's "Negative" field for every gen)

```
blurry, realistic, photo, 3d render, modern, multiple characters, text, watermark, signature, full body, wide shot, complex background, scenic landscape, city, forest, sky, room interior, detailed backdrop, anime, chibi, cute
```

---

## Shared boilerplate (prepend to every character prompt)

```
Balatro-style pixel-art character portrait, anthropomorphic ANIMAL in formal courtroom attire, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

Replace `ANIMAL` inline with the per-character species below if the generator
drops it; otherwise keep it generic and let the per-character line specify.

---

## Character prompts

### 1. Novice — The Defendant (RAT)

Target file: `public/images/personas/novice.png`

**Voice brief:** working-class London, nervous young male, obvious tells.
**Animal semantic:** rat = stereotypical nervous-guilty-mark, matches voice.

> Shared boilerplate + `jittery young rat in a cheap rumpled grey pinstripe suit and loose stained tie, darting pink eyes wide with panic, visible sweat bead on forehead, whiskers twitching, shoulders hunched, amber lamp side-light, visible stubble of fur, torn collar`

**This is the hardest character — generate this one FIRST** to lock the seed
and calibrate the style before spending credits on the rest.

---

### 2. Reader — The Prosecutor (FOX)

Target file: `public/images/personas/reader.png`

**Voice brief:** American neutral, late-50s male, Gus-Fring register.
**Animal semantic:** fox = calculating pattern-recognizer, natural prosecutor.

> Shared boilerplate + `composed calculating red fox in a crisp jet-black three-piece suit with blood-red tie, steel-rim glasses perched low on snout, expressionless cold golden eyes, ears slightly forward, paws clasped, amber courtroom glow, faint smirk, groomed`

---

### 3. Misdirector — The Attorney (PEACOCK or MAGPIE)

Target file: `public/images/personas/misdirector.png`

**Voice brief:** British RP 40s male, theatrical, inverted tell.
**Animal semantic options** (pick during generation):
- **Peacock**: showman, visibly preening, literal "display"
- **Magpie**: European mythology of the thief/trickster — safer mechanical fit for the MIS-director

Try peacock first; if it reads as "vain bird" rather than "barrister," swap to magpie.

> Shared boilerplate + `theatrical peacock in a tailored navy pinstripe suit with iridescent blue-green silk cravat, long elegant neck, sly half-smile, one feather-hand gesturing mid-speech, partial fan of tail feathers glimpsed behind, confident showman`

**Magpie alt:**

> Shared boilerplate + `theatrical magpie in a tailored navy pinstripe suit with silver pocket chain, black and white plumage with iridescent indigo flash, sly knowing half-smile, one wing-hand gesturing mid-speech, confident trickster`

---

### 4. Silent — The Judge (OWL)

Target file: `public/images/personas/silent.png`

**Voice brief:** British RP elderly 70s male, deep gravelly, minimal tells.
**Animal semantic:** owl = wise, silent, end-boss archetype.

> Shared boilerplate + `ancient great grey owl in full black court robe and powdered white bench wig, deep yellow eyes half-lidded and unreadable, gnarled feathered hands out of frame, lit dramatically from below by candlelight, stern gravitas, worn feathers`

---

### 5. Clerk — Tutorial host (RAVEN) — OPTIONAL

Target file: `public/images/personas/clerk.png`

Already covered by the inline SVG `<ClerkSprite>` fallback, so this one is
nice-to-have not required. If you burn a credit, use:

> Shared boilerplate + `attentive raven in a simple black robe with stiff white jabot collar, sharp intelligent eyes, slight head tilt, small scroll tucked under one wing, bureaucratic but warm, glossy black feathers`

---

## Fallback workflow — Nano Banana Pro → SpriteLab upload

If Retro Diffusion's Portrait mode doesn't nail the Balatro aesthetic or the
rat reads as off after 3-4 regens:

1. Open [Google AI Studio](https://aistudio.google.com/) → Gemini 3 Pro /
   Nano Banana Pro. Paste the character prompt WITHOUT the pixel-art
   boilerplate (let it render freely — painterly, stylized, high-detail).
2. Download the output.
3. Open [SpriteLab](https://spritelab.dev/) → **Simple Upload** tab.
4. Upload the Gemini output → SpriteLab crunches to clean pixel art with
   proper palette, outlines, transparent bg.
5. Export PNG.

SpriteLab's free tier: 10 credits, 4 variants per gen = 40 outputs. Plenty
for 5 characters.

---

## Post-processing checklist (after download)

- [ ] **Background removal** via [remove.bg](https://www.remove.bg/) (drag
      and drop, free, 1 click). Confirm alpha channel is clean —
      SpriteLab's built-in editor catches stray pixels if remove.bg misses.
- [ ] **Aspect check**: target 2:3 bust, crop if the gen came out 1:1 square
      (crop to keep head + upper torso, drop the legs).
- [ ] **File save**: `public/images/personas/{novice,reader,misdirector,silent,clerk}.png`
      (lowercase — the `<PersonaPortrait>` loader expects this exact naming).
- [ ] **Style consistency audit**: lay all 5 side by side. Do they read as
      "same artist, same world"? If one drifts hard, regen with the locked
      seed + tightened per-character description.
- [ ] **Drop in**: `pnpm dev`, refresh `/game`, start a trial. The moment
      the PNG exists at the target path, `<PersonaPortrait>` swaps from
      silhouette → PNG automatically.

---

## Attribution

Art direction + prompt authoring: 2026-04-21.
Pipeline wired via `src/components/game/Scene/PersonaPortrait.tsx` +
`src/components/game/Scene/ClerkSprite.tsx`.
