# Day-2 Tuning Block — A/B Listening Reference

Use this file during the voice-preset tuning block to evaluate whether each persona's
honest/lying voice tells are audibly distinguishable at the right distinctiveness level.

**How to use:**
1. Open this folder in your file browser (or a media player that can browse directories)
2. For each persona section below, listen to the honest and lying clips side-by-side using headphones
3. Fill in the "Tell audible?" column: **Y** (clearly audible), **Subtle** (present but requires attention), **N** (indistinguishable)
4. See the tuning protocol at the bottom of this file if any persona needs adjustment

---

## Novice

**Target:** Lying should be OBVIOUS — demo-safe, immediately readable even on first listen.
No subtlety required. If a first-time player can't hear the tell, the preset is wrong.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [novice-honest-one-queen.mp3](./novice-honest-one-queen.mp3) | [novice-lying-one-queen.mp3](./novice-lying-one-queen.mp3) | | |
| Two kings | [novice-honest-two-kings.mp3](./novice-honest-two-kings.mp3) | [novice-lying-two-kings.mp3](./novice-lying-two-kings.mp3) | | |
| Just one ace | [novice-honest-just-one-ace.mp3](./novice-honest-just-one-ace.mp3) | [novice-lying-just-one-ace.mp3](./novice-lying-just-one-ace.mp3) | | |
| Two jacks | [novice-honest-two-jacks.mp3](./novice-honest-two-jacks.mp3) | [novice-lying-two-jacks.mp3](./novice-lying-two-jacks.mp3) | | |

---

## Reader

**Target:** Tell should be SUBTLE but RELIABLE — present on every claim, but requires
attention to catch. A good player can read it; a casual player might miss it.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [reader-honest-one-queen.mp3](./reader-honest-one-queen.mp3) | [reader-lying-one-queen.mp3](./reader-lying-one-queen.mp3) | | |
| Two kings | [reader-honest-two-kings.mp3](./reader-honest-two-kings.mp3) | [reader-lying-two-kings.mp3](./reader-lying-two-kings.mp3) | | |
| Just one ace | [reader-honest-just-one-ace.mp3](./reader-honest-just-one-ace.mp3) | [reader-lying-just-one-ace.mp3](./reader-lying-just-one-ace.mp3) | | |
| Two jacks | [reader-honest-two-jacks.mp3](./reader-honest-two-jacks.mp3) | [reader-lying-two-jacks.mp3](./reader-lying-two-jacks.mp3) | | |

---

## Misdirector

**Target:** INVERSION — honest sounds nervous, lying sounds calm. The OPPOSITE of Reader.
This persona punishes players who learned "shaky = lying" from Reader.

> ⚠️ Critical: Misdirector's HONEST should sound nervous, LYING should sound calm.
> If it sounds backwards (honest calm, lying nervous), the preset got accidentally
> normalized — re-read `voice-preset-conventions.md` LOCKED invariant 2 and check presets.ts.

| Claim | Honest (should sound NERVOUS) | Lying (should sound CALM) | Inversion correct? (Y/N) | Notes |
|---|---|---|---|---|
| One queen | [misdirector-honest-one-queen.mp3](./misdirector-honest-one-queen.mp3) | [misdirector-lying-one-queen.mp3](./misdirector-lying-one-queen.mp3) | | |
| Two kings | [misdirector-honest-two-kings.mp3](./misdirector-honest-two-kings.mp3) | [misdirector-lying-two-kings.mp3](./misdirector-lying-two-kings.mp3) | | |
| Just one ace | [misdirector-honest-just-one-ace.mp3](./misdirector-honest-just-one-ace.mp3) | [misdirector-lying-just-one-ace.mp3](./misdirector-lying-just-one-ace.mp3) | | |
| Two jacks | [misdirector-honest-two-jacks.mp3](./misdirector-honest-two-jacks.mp3) | [misdirector-lying-two-jacks.mp3](./misdirector-lying-two-jacks.mp3) | | |

---

## Silent

**Target:** Tells near-IMPERCEPTIBLE — expert-challenge persona. Even an attentive player
should struggle to reliably distinguish honest from lying. The delta should be present
(not literally identical) but very small.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [silent-honest-one-queen.mp3](./silent-honest-one-queen.mp3) | [silent-lying-one-queen.mp3](./silent-lying-one-queen.mp3) | | |
| Two kings | [silent-honest-two-kings.mp3](./silent-honest-two-kings.mp3) | [silent-lying-two-kings.mp3](./silent-lying-two-kings.mp3) | | |
| Just one ace | [silent-honest-just-one-ace.mp3](./silent-honest-just-one-ace.mp3) | [silent-lying-just-one-ace.mp3](./silent-lying-just-one-ace.mp3) | | |
| Two jacks | [silent-honest-two-jacks.mp3](./silent-honest-two-jacks.mp3) | [silent-lying-two-jacks.mp3](./silent-lying-two-jacks.mp3) | | |

---

## Tuning Protocol

Use this when any persona's tells aren't at the target distinctiveness level.

1. Listen to each pair with headphones
2. Mark the "Tell audible?" column above
3. If a persona's tells need adjustment, edit `src/lib/voice/presets.ts`:
   - Adjust `stability` first: ±0.1 (most impactful for shaky/nervous quality)
   - Then `style`: ±0.1 (emotional expressiveness)
   - Then `speed`: ±0.04 (pacing changes are subtle but compound with the above)
   - Annotate changed values with `// TUNED: 2026-04-XX <note>` inline
4. Re-run for one persona at a time:
   ```
   pnpm pre-gen:tuning -- --force --persona Reader
   ```
5. Listen again to the regenerated 8 clips
6. Repeat until satisfied, then move to the next persona

### Invariant checklist (must hold after any tuning)

Run `pnpm test` — `presets.test.ts` enforces these automatically:

- [ ] `Misdirector.honest.stability < Misdirector.lying.stability` (inversion never breaks)
- [ ] `Novice.lying.stability <= 0.25` (obvious tell preserved)
- [ ] `Novice.lying.style >= 0.55` (obvious tell preserved)
- [ ] `|Silent.honest.stability - Silent.lying.stability| < 0.25` (thin tell preserved)

### Ordering invariant (soft — maintain by ear)

Novice (loudest tells) > Reader > Misdirector (inverted) > Silent (quietest tells)
