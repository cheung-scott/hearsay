# Persona portraits

Drop the 5 persona bust-shot PNGs here. The `<PersonaPortrait>` and
`<ClerkSprite>` components auto-load them at runtime with silhouette /
inline-SVG fallback, so missing files fall back gracefully until generated.

## Expected files

| Filename | Character | Voice brief |
|----------|-----------|-------------|
| `novice.png` | The Defendant (rat) | Nervous young Londoner |
| `reader.png` | The Prosecutor (fox) | Calm calculating American, Gus-Fring register |
| `misdirector.png` | The Attorney (peacock / magpie) | Theatrical British RP |
| `silent.png` | The Judge (owl) | Elderly British RP, gravelly |
| `clerk.png` | Tutorial host (raven) — optional | Warm bureaucratic British |

## Format

- PNG with transparent background
- ~256×384 or larger (component scales to 160×240 slot with `object-fit: contain`)
- Bust shot (head + chest); legs/tail get cropped in the slot

## Generation workflow

See `scripts/persona-portrait-prompts.md` for the full prompt sheet, tool
settings, and post-processing checklist. Mirror of the same in the vault at
`Obsidian_Vault/Projects/ElevenHacks-Kiro/PERSONA-PORTRAITS.md`.
