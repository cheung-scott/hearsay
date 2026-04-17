// Tests for stt.ts — exercising extractVoiceMeta (pure helper).
// No SDK mocks needed; we pass fake SpeechToTextChunkResponseModel objects.

import { describe, it, expect } from 'vitest';
import { extractVoiceMeta, STTUnexpectedResponseError } from './stt';
import { computeLieScore } from './heuristic';

// ---------------------------------------------------------------------------
// Helpers to build fake word entries
// ---------------------------------------------------------------------------

type WordType = 'word' | 'spacing' | 'audio_event';

function word(
  text: string,
  start: number,
  end: number,
  type: WordType = 'word',
) {
  return { text, start, end, type, logprob: 0 };
}

function makeChunk(
  words: ReturnType<typeof word>[],
  text: string,
  audioDurationSecs?: number,
) {
  return {
    languageCode: 'eng',
    languageProbability: 0.99,
    text,
    words,
    ...(audioDurationSecs !== undefined ? { audioDurationSecs } : {}),
  };
}

// ---------------------------------------------------------------------------
// 1. Happy path: 5 words, 1 filler, 1 long pause
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — happy path', () => {
  // words: "um"(0.2-0.5) "I"(0.6-0.7) "played"(0.8-1.0) <pause 600ms> "a"(1.6-1.7) "queen"(1.8-2.0)
  //   latencyMs = 0.2 * 1000 = 200
  //   fillerCount = 1 ("um")
  //   pauseCount = 1 (gap from end=1.0 to start=1.6 → 600ms > 400ms)
  //   audioDurationSecs = 3.0 → wpm = 5 / (3/60) = 100
  //   lieScore = computeLieScore({ latencyMs:200, fillerCount:1, pauseCount:1, speechRateWpm:100 })

  const words = [
    word('um', 0.2, 0.5),
    word('I', 0.6, 0.7),
    word('played', 0.8, 1.0),
    word('a', 1.6, 1.7),
    word('queen', 1.8, 2.0),
  ];
  const chunk = makeChunk(words, 'um I played a queen', 3.0);

  it('latencyMs is time to first word * 1000', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.latencyMs).toBe(200);
  });

  it('fillerCount counts filler words in transcript', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.fillerCount).toBe(1);
  });

  it('pauseCount counts inter-word gaps > 400ms', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.pauseCount).toBe(1);
  });

  it('speechRateWpm = wordCount / (audioDurationSecs / 60)', () => {
    const result = extractVoiceMeta(chunk);
    // 5 words / (3 / 60) = 5 * 20 = 100
    expect(result.speechRateWpm).toBeCloseTo(100, 5);
  });

  it('lieScore matches computeLieScore with derived signals', () => {
    const result = extractVoiceMeta(chunk);
    const expected = computeLieScore({
      latencyMs: 200,
      fillerCount: 1,
      pauseCount: 1,
      speechRateWpm: 100,
    });
    expect(result.lieScore).toBeCloseTo(expected, 10);
  });

  it('transcript is passed through from chunk.text', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.transcript).toBe('um I played a queen');
  });

  it('audioDurationSecs is passed through', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.audioDurationSecs).toBe(3.0);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty words array
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — empty words array', () => {
  // wpm = 0 (no words, duration > 0)
  // speechRateWpm = 0 → out of [120,220] range → rat = 1 → contributes 0.1
  // latencyMs = 0, fillerCount = 0, pauseCount = 0
  // lieScore = (4*0 + 3*0 + 2*0 + 1*1) / 10 = 0.1

  const chunk = makeChunk([], '', 5.0);

  it('latencyMs = 0', () => {
    expect(extractVoiceMeta(chunk).latencyMs).toBe(0);
  });

  it('pauseCount = 0', () => {
    expect(extractVoiceMeta(chunk).pauseCount).toBe(0);
  });

  it('speechRateWpm = 0', () => {
    expect(extractVoiceMeta(chunk).speechRateWpm).toBe(0);
  });

  it('lieScore = 0.1 (wpm=0 is out of [120,220] → rate=1, all others 0)', () => {
    // wpm=0 is out of range → rat=1 → lieScore = 1/10 = 0.1
    expect(extractVoiceMeta(chunk).lieScore).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// 3. audio_event entries mixed in — should NOT count toward wpm or pauseCount
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — audio_event entries are skipped', () => {
  // word(0.0-0.5) audio_event(0.6-0.8) audio_event(0.9-1.1) word(1.2-1.5)
  // gap for pause: only word-to-word → end=0.5 to start=1.2 = 700ms > 400ms → 1 pause
  // wordCount = 2

  const words = [
    word('I', 0.0, 0.5),
    word('(laughter)', 0.6, 0.8, 'audio_event'),
    word('(breath)', 0.9, 1.1, 'audio_event'),
    word('played', 1.2, 1.5),
  ];
  const chunk = makeChunk(words, 'I played', 2.0);

  it('audio_event entries do not count toward wpm', () => {
    const result = extractVoiceMeta(chunk);
    // 2 word-type entries / (2 / 60) = 60
    expect(result.speechRateWpm).toBeCloseTo(60, 5);
  });

  it('audio_event entries are skipped when computing pauseCount', () => {
    const result = extractVoiceMeta(chunk);
    // word(end=0.5) → word(start=1.2): gap = 700ms > 400ms → 1 pause
    expect(result.pauseCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing audioDurationSecs → defaults to 0 → wpm = 0
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — missing audioDurationSecs', () => {
  const words = [word('hello', 0.1, 0.5), word('there', 0.6, 1.0)];
  // No audioDurationSecs field at all
  const chunk = makeChunk(words, 'hello there');

  it('audioDurationSecs defaults to 0', () => {
    expect(extractVoiceMeta(chunk).audioDurationSecs).toBe(0);
  });

  it('speechRateWpm = 0 when audioDurationSecs is missing', () => {
    expect(extractVoiceMeta(chunk).speechRateWpm).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Saturating inputs → lieScore near 1.0
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — saturating inputs', () => {
  // latencyMs >= 2000: need first word start >= 2.0s
  // fillerCount >= 3: "um uh er like" → 4 fillers
  // pauseCount >= 3: need 3+ inter-word gaps > 400ms
  // speechRateWpm < 120 or > 220: with short audio and many words → use long audio, few words

  // 4 words over 30 seconds → wpm = 4/(30/60) = 8 → out of range
  // First word starts at 2.5s → latencyMs = 2500 → saturates at 2000
  // Pauses: word(2.5-2.7) gap=600ms word(3.3-3.5) gap=600ms word(4.1-4.3) gap=600ms word(4.9-5.1)
  // fillers: "um uh er like" → 4 (> saturation of 3)

  const words = [
    word('um', 2.5, 2.7),
    word('uh', 3.3, 3.5),
    word('er', 4.1, 4.3),
    word('like', 4.9, 5.1),
  ];
  const chunk = makeChunk(words, 'um uh er like', 30.0);

  it('lieScore = 1.0 when all signals saturate', () => {
    const result = extractVoiceMeta(chunk);
    expect(result.lieScore).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 6. Unparseable response — throws STTUnexpectedResponseError
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — unparseable response', () => {
  it('throws STTUnexpectedResponseError when words array is absent', () => {
    const badResponse = {
      message: 'processing',
      requestId: 'abc',
      transcriptionId: 'def',
    };
    expect(() => extractVoiceMeta(badResponse)).toThrow(
      STTUnexpectedResponseError,
    );
  });

  it('error message includes a slice of the bad response', () => {
    const badResponse = { message: 'processing', requestId: 'abc' };
    expect(() => extractVoiceMeta(badResponse)).toThrow(
      'Expected chunk response with words',
    );
  });

  it('throws STTUnexpectedResponseError for null input', () => {
    expect(() => extractVoiceMeta(null)).toThrow(STTUnexpectedResponseError);
  });
});

// ---------------------------------------------------------------------------
// 7. FILLER_REGEX integration
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — FILLER_REGEX integration', () => {
  it('"um, I think I played a queen, you know" → fillerCount = 2', () => {
    const words = [
      word('um', 0.0, 0.2),
      word('I', 0.3, 0.4),
      word('think', 0.5, 0.6),
      word('I', 0.7, 0.8),
      word('played', 0.9, 1.0),
      word('a', 1.1, 1.2),
      word('queen', 1.3, 1.5),
      word('you', 1.6, 1.7),
      word('know', 1.8, 1.9),
    ];
    const chunk = makeChunk(
      words,
      'um, I think I played a queen, you know',
      2.5,
    );
    expect(extractVoiceMeta(chunk).fillerCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Pause boundary — exactly 400ms vs 401ms
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — pause boundary (strictly > 400ms)', () => {
  it('gap of exactly 400ms is NOT counted', () => {
    // word(0.0-0.5) word(0.9-1.0): gap = 0.4s = 400ms → not counted
    const words = [word('I', 0.0, 0.5), word('played', 0.9, 1.0)];
    const chunk = makeChunk(words, 'I played', 1.5);
    expect(extractVoiceMeta(chunk).pauseCount).toBe(0);
  });

  it('gap of 401ms IS counted', () => {
    // word(0.0-0.5) word(0.901-1.0): gap = 0.401s = 401ms → counted
    const words = [word('I', 0.0, 0.5), word('played', 0.901, 1.0)];
    const chunk = makeChunk(words, 'I played', 1.5);
    expect(extractVoiceMeta(chunk).pauseCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Pauses skip non-word entries (audio_event between words)
// ---------------------------------------------------------------------------
describe('extractVoiceMeta — pauses skip non-word entries', () => {
  it('word(end=1.0) → audio_event(1.1-1.2) → word(start=1.6) → gap = 600ms = 1 pause', () => {
    const words = [
      word('I', 0.0, 1.0),
      word('(laughter)', 1.1, 1.2, 'audio_event'),
      word('played', 1.6, 2.0),
    ];
    const chunk = makeChunk(words, 'I played', 2.5);
    const result = extractVoiceMeta(chunk);
    // Only 2 word-type entries → 1 gap: 1.6 - 1.0 = 0.6s = 600ms > 400ms
    expect(result.pauseCount).toBe(1);
  });
});
