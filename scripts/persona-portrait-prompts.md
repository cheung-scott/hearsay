# Persona Portrait Prompts — Retro Diffusion (primary) + fallbacks

Generation spec for the 5 Hearsay persona portraits. Output drops into
`public/images/personas/{novice,reader,misdirector,silent,clerk}.png`
where `<PersonaPortrait>` + `<ClerkSprite>` auto-load them with silhouette /
SVG fallback.

**Art direction:** anthropomorphic animals in Balatro-style painterly pixel
art. Voice casting is already locked to human archetypes (nervous Londoner,
Gus-Fring prosecutor, British barrister, elderly judge, clerk) — the animal
layer sits ON TOP of that, creating productive dissonance.

**Status (2026-04-21):** Novice rat locked after 5 iterations. Fox / Owl /
Peacock / Raven prompts below are ship-ready — same seed as the rat, same
settings, no further tweaks needed.

---

## Tool settings (Retro Diffusion web app)

| Field | Value |
|-------|-------|
| **Model** | `RD Fast` (1 credit/gen — stretches the free 50 across iterations) |
| **Art Style** | `Portrait` (single-view, painterly, atmospheric — closest Balatro match) |
| **Width × Height** | **256 × 384** (2:3 vertical; matches the `<PersonaPortrait>` 160×240 slot) |
| **Seed** | Locked on rat #5 — reuse across all 5 for set consistency |
| **Tiling** | Both OFF |
| **Remove Background** | ✅ ON (transparent PNG direct, skips remove.bg post-step) |
| **Palette** | Default (skip palette lock; per-character hex codes are in the prompt) |

---

## Bug-avoidance lessons from rat iterations

1. **Do NOT include concrete light-source nouns** like `amber lamp side-light` — the model spawns a literal lamp in the frame. Use `warm amber rim lighting from the side` instead.
2. **Do NOT use `torn collar` or similar clothing-mess descriptors** — they cause dual-ties or layered clothing artifacts.
3. **Do NOT use `closed mouth trembling` alone** — "trembling" allows partial opening + teeth show. Use `mouth pressed firmly closed with lips together` (or per-character variant).
4. **Prefer static or minimal-gesture poses** — `paws clasped calmly` / `hand resting on lapel` are safer than `fidgeting with tie` (the latter caused the two-tie render on the rat).
5. **`classic [species] face with [anatomical feature]`** anchors species correctly — prevents humanoid drift.

---

## Character prompts — FINAL, ship-ready

### 1. Novice — The Defendant (RAT) — ✅ LOCKED

Target file: `public/images/personas/novice.png`

**Voice brief:** working-class London, nervous young male, obvious tells.
**Final prompt (rat #5):**

```
Balatro-style pixel-art character portrait, scrawny young rat in a cheap rumpled grey pinstripe suit and loose ochre tie, wide worried round rat eyes looking forward and making brief uncomfortable eye contact with the viewer, mouth pressed firmly closed with lips together, ears tilted forward alert, one paw fidgeting with tie nervously, hunched shoulders, fur slightly tousled, sweat glistening on forehead, whiskers twitching, anxious and youthful, classic rodent face with prominent snout and long tail, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

*Note: rat #5 has a minor two-tie rendering artifact at 1024×1536 that's fully occluded by the courtroom table at the in-game 160×240 scale. Not an issue in practice.*

---

### 2. Reader — The Prosecutor (FOX)

Target file: `public/images/personas/reader.png`

**Voice brief:** American neutral, late-50s male, Gus-Fring register.

```
Balatro-style pixel-art character portrait, composed middle-aged red fox prosecutor in a crisp jet-black three-piece suit with blood-red silk tie, cold calculating golden eyes making unflinching direct eye contact with the viewer, mouth pressed in a thin impassive half-smile, ears held upright and alert, paws clasped calmly in front, fur neatly groomed, silver-rimmed reading glasses perched low on snout, classic vulpine face with long pointed snout and orange-red fur with white chest, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

---

### 3. Silent — The Judge (OWL)

Target file: `public/images/personas/silent.png`

**Voice brief:** British RP elderly 70s male, deep gravelly, minimal tells.

```
Balatro-style pixel-art character portrait, ancient stern great grey owl judge in a full black court robe with white fur trim, powdered white British bench wig with long curled sides, deep yellow eyes half-lidded and completely unreadable, making cold penetrating direct eye contact with the viewer, beak pressed shut in dispassionate judgment, large round feathered facial disk with subtle aged wrinkles, feathered arms folded solemnly across the chest, slate grey mottled plumage, classic strigiform face with hooked beak and tufted brow feathers, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

---

### 4. Misdirector — The Attorney (PEACOCK → MAGPIE fallback)

Target file: `public/images/personas/misdirector.png`

**Voice brief:** British RP 40s male, theatrical, inverted tell (smooth when lying).

#### Peacock (try first)

```
Balatro-style pixel-art character portrait, theatrical British peacock attorney in a tailored navy pinstripe three-piece suit with iridescent blue-green silk cravat at the throat, sly knowing dark eyes making confident direct eye contact with the viewer, mouth curled in a small smug half-smile, elegant long neck with iridescent blue-green plumage, crown of slender display feathers rising from the top of the head, one feathered hand resting confidently on the lapel, hints of iridescent blue-green plumage visible at the shoulders, classic peafowl face with sleek small grey beak, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

#### Magpie (fallback if peacock reads as "vain bird" not "barrister" after 2 tries)

```
Balatro-style pixel-art character portrait, theatrical British magpie attorney in a tailored navy pinstripe three-piece suit with silver silk cravat, sly knowing eyes making confident direct eye contact with the viewer, mouth curled in a small smug half-smile, glossy black and white plumage with iridescent indigo flash on the wings, one feathered hand resting confidently on the lapel, classic corvid face with strong sharp beak, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

---

### 5. Clerk — Tutorial host (RAVEN) — OPTIONAL

Target file: `public/images/personas/clerk.png`

**Voice brief:** British RP 40s female, warm-bureaucratic, procedural.

Already covered by the inline SVG `<ClerkSprite>` fallback, so this one is
nice-to-have. Only generate if 5+ credits remain after the top 3.

```
Balatro-style pixel-art character portrait, attentive middle-aged raven court clerk in a simple black formal robe with a crisp white jabot collar, sharp intelligent amber-gold eyes making warm direct eye contact with the viewer, beak pressed together in a gentle attentive expression, small neat slicked-back crest of feathers on the head, feathered hands holding a small rolled parchment scroll at chest level, glossy black iridescent plumage with subtle purple highlights, slight head tilt conveying helpful attention, classic corvid face with strong black beak, warm amber rim lighting from the side, bust shot from chest up, front-facing, solid black thick outline, painterly cel-shading, warm desaturated palette (amber #fda200, bone cream #e8dcc8, deep felt green #1a2e1a, coral #fd5f55, dark wall brown), soft CRT scanline glow, plain neutral background, chunky pixel detail, single character, ominous courtroom mood,
```

---

## Generation order (risk ascending)

1. **Fox** — well-represented archetype in training, lowest risk of bugs
2. **Owl** — distinctive species, stern pose is stable
3. **Peacock** — most creative (may need 2-3 tries; magpie fallback ready)
4. **Raven** — only if credits allow

Budget estimate: ~8-12 credits for the four, leaving ~30 for rat revisit if needed.

---

## Fallback workflow — Nano Banana Pro → SpriteLab upload

If Retro Diffusion's Portrait mode can't nail a character after 3-4 regens:

1. Open [Google AI Studio](https://aistudio.google.com/) → Gemini 3 Pro /
   Nano Banana Pro. Paste the character prompt WITHOUT the pixel-art
   boilerplate (let it render freely — painterly, stylized, high-detail).
2. Download the output.
3. Open [SpriteLab](https://spritelab.dev/) → **Simple Upload** tab.
4. Upload the Gemini output → SpriteLab crunches to clean pixel art with
   proper palette, outlines, transparent bg.
5. Export PNG.

SpriteLab's free tier: 10 credits, 4 variants per gen = 40 outputs.

---

## Post-processing checklist (per character)

- [ ] **Background removal** — skip if Retro Diffusion's Remove Background was ON. Otherwise [remove.bg](https://www.remove.bg/), drag-drop, free.
- [ ] **Aspect check**: target 2:3 bust. Crop if the gen came out 1:1 (keep head + upper torso, drop legs).
- [ ] **File save**: `D:/Projects/hearsay/public/images/personas/{novice,reader,misdirector,silent,clerk}.png` (lowercase — `<PersonaPortrait>` loader expects exact names).
- [ ] **Drop in**: refresh `/game`, start a trial with that persona's case. PNG auto-loads the moment the file exists.
- [ ] **Style consistency audit** after all 5 are in place: do they read "same artist, same world"? If one drifts, regen with same seed + tighter per-character description.

---

## Attribution

Art direction + prompt authoring: 2026-04-21.
Pipeline wired via `src/components/game/Scene/PersonaPortrait.tsx` +
`src/components/game/Scene/ClerkSprite.tsx`.
