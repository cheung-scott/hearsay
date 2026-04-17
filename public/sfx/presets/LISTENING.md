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
Invariant: `stability <= 0.25` AND `style >= 0.55` on lying preset.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [honest](./novice-honest-one-queen.mp3) | [lying](./novice-lying-one-queen.mp3) | | |
| Two kings | [honest](./novice-honest-two-kings.mp3) | [lying](./novice-lying-two-kings.mp3) | | |
| Just one ace | [honest](./novice-honest-just-one-ace.mp3) | [lying](./novice-lying-just-one-ace.mp3) | | |
| Two jacks | [honest](./novice-honest-two-jacks.mp3) | [lying](./novice-lying-two-jacks.mp3) | | |

---

## Reader

**Target:** Tell should be SUBTLE but RELIABLE — present on every claim, but requires
attention to catch. A good player can read it; a casual player might miss it.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [honest](./reader-honest-one-queen.mp3) | [lying](./reader-lying-one-queen.mp3) | | |
| Two kings | [honest](./reader-honest-two-kings.mp3) | [lying](./reader-lying-two-kings.mp3) | | |
| Just one ace | [honest](./reader-honest-just-one-ace.mp3) | [lying](./reader-lying-just-one-ace.mp3) | | |
| Two jacks | [honest](./reader-honest-two-jacks.mp3) | [lying](./reader-lying-two-jacks.mp3) | | |

---

## Misdirector

**Target:** INVERSION — honest sounds nervous, lying sounds calm. The OPPOSITE of Reader.
This persona punishes players who learned "shaky = lying" from Reader.

> **⚠️ Misdirector inversion check**
>
> Misdirector's HONEST clip should sound NERVOUS. Misdirector's LYING clip should sound CALM.
> If it sounds backwards (honest calm, lying nervous), the preset was accidentally normalised —
> re-read `voice-preset-conventions.md` LOCKED invariant 2 and check `presets.ts`.
> The invariant test (`pnpm test`) enforces: `Misdirector.honest.stability < Misdirector.lying.stability`.

| Claim | Honest (should sound NERVOUS) | Lying (should sound CALM) | Inversion correct? (Y/N) | Notes |
|---|---|---|---|---|
| One queen | [honest](./misdirector-honest-one-queen.mp3) | [lying](./misdirector-lying-one-queen.mp3) | | |
| Two kings | [honest](./misdirector-honest-two-kings.mp3) | [lying](./misdirector-lying-two-kings.mp3) | | |
| Just one ace | [honest](./misdirector-honest-just-one-ace.mp3) | [lying](./misdirector-lying-just-one-ace.mp3) | | |
| Two jacks | [honest](./misdirector-honest-two-jacks.mp3) | [lying](./misdirector-lying-two-jacks.mp3) | | |

---

## Silent

**Target:** Tells near-IMPERCEPTIBLE — expert-challenge persona. Even an attentive player
should struggle to reliably distinguish honest from lying. The delta should be present
(not literally identical) but very small.
Invariant: `|honest.stability − lying.stability| < 0.25`.

| Claim | Honest | Lying | Tell audible? (Y/N/Subtle) | Notes |
|---|---|---|---|---|
| One queen | [honest](./silent-honest-one-queen.mp3) | [lying](./silent-lying-one-queen.mp3) | | |
| Two kings | [honest](./silent-honest-two-kings.mp3) | [lying](./silent-lying-two-kings.mp3) | | |
| Just one ace | [honest](./silent-honest-just-one-ace.mp3) | [lying](./silent-lying-just-one-ace.mp3) | | |
| Two jacks | [honest](./silent-honest-two-jacks.mp3) | [lying](./silent-lying-two-jacks.mp3) | | |

---

## Tuning Protocol

1. Listen to each pair with headphones
2. Mark "Tell audible?" in the table above
3. If a persona's tells need adjustment, edit `src/lib/voice/presets.ts`:
   - Adjust `stability` first: ±0.1 (most impactful for shaky/nervous quality)
   - Then `style`: ±0.1 (emotional expressiveness)
   - Then `speed`: ±0.04 (pacing changes are subtle but compound with the above)
4. Run `pnpm test` to verify the Misdirector inversion invariant and Novice audibility invariant still hold
5. Re-run for one persona at a time:
   ```
   pnpm pre-gen:tuning -- --force --persona <NAME>
   ```
6. Re-listen to the regenerated 8 clips and repeat until satisfied
