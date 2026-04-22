import type { Persona, Rank } from '../game/types';

/**
 * Persona descriptions — verbatim from steering/llm-prompt-conventions.md.
 * Used in LLM prompt preambles ("You are {{persona}}: {{personaDescription}}.").
 */
export const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  Novice:
    'a new player who bluffs poorly and reads opponents carelessly. Your voice leaks obvious tells when you lie.',
  Reader:
    'balanced and observant. You read opponents carefully. Your voice leaks subtle tells when you lie.',
  Misdirector:
    'a manipulator who fakes nervousness when telling the truth and stays calm when lying. Confident, theatrical, tricky.',
  Silent:
    'minimal giveaways. Stoic and observant. Strong reader of others, very subtle tells of your own.',
};

/**
 * Pluralize rank name when count === 2.
 * Queen, King, Ace, Jack → Queens, Kings, Aces, Jacks.
 */
function pluralise(rank: Rank, count: number): string {
  return count === 2 ? `${rank}s` : rank;
}

/**
 * Four dialogue variants per persona, returned based on rng() index.
 * Honest claim — persona tone follows their archetype (nervous, measured,
 * theatrical-but-faking-nerves, terse).
 */
function templateHonest(
  persona: Persona,
  count: 1 | 2,
  rank: Rank,
  rng: () => number = Math.random,
): string {
  const idx = Math.floor(rng() * 4);
  const rankStr = pluralise(rank, count);

  const variants: Record<Persona, string[]> = {
    Novice: [
      `Um... ${count} ${rankStr}, I think.`,
      `I've got, um, ${count} ${rankStr} here.`,
      `Maybe ${count} ${rankStr}? I'm not totally sure.`,
      `${count} ${rankStr}, I believe.`,
    ],
    Reader: [
      `${count} ${rankStr}.`,
      `I have ${count} ${rankStr}.`,
      `Claiming ${count} ${rankStr}.`,
      `That's ${count} ${rankStr}.`,
    ],
    Misdirector: [
      `A delicate ${count} ${rankStr}.`,
      `Could be ${count} ${rankStr}... or not.`,
      `I'm... ${count} ${rankStr}, definitely.`,
      `For the record, ${count} ${rankStr}.`,
    ],
    Silent: [
      `${count} ${rankStr}.`,
      `I play ${count} ${rankStr}.`,
      `${count} ${rankStr}, placed.`,
      `${count} ${rankStr}, done.`,
    ],
  };

  return variants[persona][idx];
}

/**
 * Four dialogue variants per persona for a lie claim.
 * Liar — persona shifts confidence per their archetype.
 */
function templateLie(
  persona: Persona,
  count: 1 | 2,
  rank: Rank,
  rng: () => number = Math.random,
): string {
  const idx = Math.floor(rng() * 4);
  const rankStr = pluralise(rank, count);

  const variants: Record<Persona, string[]> = {
    Novice: [
      `I, um, have ${count} ${rankStr}.`,
      `Definitely... ${count} ${rankStr}.`,
      `I think that's ${count} ${rankStr}.`,
      `${count} ${rankStr}, uh, yeah.`,
    ],
    Reader: [
      `${count} ${rankStr}.`,
      `I'm playing ${count} ${rankStr}.`,
      `${count} ${rankStr} is my claim.`,
      `That's ${count} ${rankStr}.`,
    ],
    Misdirector: [
      `Oh, ${count} ${rankStr}, obviously.`,
      `Obviously, ${count} ${rankStr}.`,
      `Clear as day — ${count} ${rankStr}.`,
      `I've got ${count} ${rankStr}, easy.`,
    ],
    Silent: [
      `${count} ${rankStr}.`,
      `I claim ${count} ${rankStr}.`,
      `${count} ${rankStr}, no more.`,
      `${count} ${rankStr}, done.`,
    ],
  };

  return variants[persona][idx];
}

/**
 * Deterministic fallback inner-thought when LLM fails.
 * Reflects persona's decision style and references mathProb and voiceLie numerically.
 * One sentence per (persona, action) pair.
 */
function buildFallbackThought(
  persona: Persona,
  action: 'accept' | 'challenge',
  mathProb: number,
  voiceLie: number,
): string {
  if (persona === 'Novice') {
    if (action === 'accept') {
      return `Not sure, but math looks ${(mathProb * 100).toFixed(0)}% lie — I'll take their word for it.`;
    } else {
      return `Math says ${mathProb.toFixed(2)} lie and voice is ${voiceLie.toFixed(2)} nervous — I'm calling it.`;
    }
  }

  if (persona === 'Reader') {
    if (action === 'accept') {
      return `Math shows ${mathProb.toFixed(2)} lie, voice reads ${voiceLie.toFixed(2)} nervous — checking the math.`;
    } else {
      return `Math says ${mathProb.toFixed(2)} lie, voice reads ${voiceLie.toFixed(2)} nervous — calling it.`;
    }
  }

  if (persona === 'Misdirector') {
    if (action === 'accept') {
      return `Their voice is ${voiceLie.toFixed(2)}. Could be a tell... I'll wait.`;
    } else {
      return `Voice is ${voiceLie.toFixed(2)} and math is ${mathProb.toFixed(2)} — too suspicious.`;
    }
  }

  if (persona === 'Silent') {
    if (action === 'accept') {
      return `Math is ${mathProb.toFixed(2)}, voice is ${voiceLie.toFixed(2)}. Holding.`;
    } else {
      return `${mathProb.toFixed(2)} math, ${voiceLie.toFixed(2)} voice. Liar.`;
    }
  }

  return '';
}

export { templateHonest, templateLie, buildFallbackThought };
