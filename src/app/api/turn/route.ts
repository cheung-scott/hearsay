// POST /api/turn — game turn handler.
//
// Parses a TurnRequest discriminated union, retrieves Session from KV,
// runs FSM + ai-opponent brain + TTS (for AiAct), persists, returns
// TurnResponse with ClientSession (always via toClientView — invariant 11).
//
// Next.js 16 App Router. Runtime pinned to Node (SDK + KV internals).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { reduce } from '@/lib/game/fsm';
import { toClientView } from '@/lib/game/toClientView';
import { InvalidTransitionError } from '@/lib/game/types';
import type { Claim, Session, VoiceMeta, JokerType } from '@/lib/game/types';
import { parseClaim } from '@/lib/game/claims';
import { dealFresh } from '@/lib/game/deck';
import { pickOffer } from '@/lib/jokers/lifecycle';
import { computeVoiceMetaFromAudio } from '@/lib/voice/stt';
import { VOICE_PRESETS, PERSONA_VOICE_IDS } from '@/lib/voice/presets';
import { aiDecideOnClaim, aiDecideOwnPlay } from '@/lib/ai/brain';
import { buildDecisionContext, buildOwnPlayContext } from '@/lib/session/buildContexts';
import * as store from '@/lib/session/store';

/**
 * After any event that could end a round, check whether the session is now
 * sitting in `round_active` with `round.status === 'round_over'`. If so,
 * auto-chain `RoundSettled` and then `JokerOffered` (or `JokerOfferEmpty` if
 * the draw pile is exhausted) so the client sees a valid `joker_offer` state
 * instead of a stuck round. Idempotent — returns session unchanged if no
 * round-end transition is pending.
 */
function autoChainRoundEnd(session: Session): Session {
  if (session.status !== 'round_active') return session;
  const currentRound = session.rounds[session.currentRoundIdx];
  if (!currentRound || currentRound.status !== 'round_over') return session;

  // Step 1: RoundSettled — may transition to session_over if strikes/rounds cap hit.
  let next = reduce(session, { type: 'RoundSettled', now: Date.now() });
  if (next.status !== 'joker_offer') return next;

  // Step 2: Offer jokers (or skip if pile is empty).
  const drawPile = next.jokerDrawPile ?? [];
  if (drawPile.length === 0) {
    const nextRoundDeal = dealFresh();
    next = reduce(next, { type: 'JokerOfferEmpty', nextRoundDeal, now: Date.now() });
    return next;
  }

  const { offered, remaining } = pickOffer(drawPile, Math.random);
  if (offered.length === 0) {
    // pickOffer returned empty despite non-empty pile — defensive fallback.
    const nextRoundDeal = dealFresh();
    next = reduce(next, { type: 'JokerOfferEmpty', nextRoundDeal, now: Date.now() });
    return next;
  }

  next = reduce(next, {
    type: 'JokerOffered',
    offered,
    newDrawPile: remaining,
    now: Date.now(),
  });
  return next;
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

type TurnRequest =
  | {
      type: 'PlayerClaim';
      sessionId: string;
      cards: { id: string }[];
      audioBase64: string;
      claimText: string;
      voiceMetaOverrides?: Partial<VoiceMeta>;
    }
  | {
      type: 'PlayerRespond';
      sessionId: string;
      action: 'accept' | 'challenge';
    }
  | {
      type: 'AiAct';
      sessionId: string;
    }
  | {
      type: 'PickJoker';
      sessionId: string;
      joker: JokerType;
    };

// ---------------------------------------------------------------------------
// ElevenLabs client (lazy — only created when ELEVENLABS_API_KEY is set)
// ---------------------------------------------------------------------------

function makeElevenLabsClient(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set on the server');
  }
  return new ElevenLabsClient({ apiKey });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a base64 string to a Buffer (Node). */
function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

/** Convert a Node ReadableStream<Uint8Array> to a base64 data URL. */
async function streamToDataUrl(
  stream: AsyncIterable<Uint8Array>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// POST /api/turn
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: TurnRequest;
  try {
    body = (await req.json()) as TurnRequest;
  } catch {
    return Response.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const sessionId = body.sessionId;
  if (!sessionId) {
    return Response.json(
      { error: { code: 'MISSING_SESSION_ID', message: 'sessionId is required in request body' } },
      { status: 400 },
    );
  }

  // Fetch session from KV.
  let session = await store.get(sessionId);
  if (!session) {
    return Response.json(
      { error: { code: 'SESSION_NOT_FOUND', message: `No session with id ${sessionId}` } },
      { status: 404 },
    );
  }

  try {
    // -----------------------------------------------------------------------
    // PlayerClaim
    // -----------------------------------------------------------------------
    if (body.type === 'PlayerClaim') {
      const { cards: cardRefs, audioBase64, claimText } = body;

      // Validate card IDs against player's hand.
      const handMap = new Map(session.player.hand.map(c => [c.id, c]));
      const invalidIds = cardRefs.filter(r => !handMap.has(r.id));
      if (invalidIds.length > 0 || cardRefs.length === 0 || cardRefs.length > 2) {
        return Response.json(
          {
            error: {
              code: 'INVALID_CARD_IDS',
              message: `Cards not found in player hand or invalid count: ${invalidIds.map(r => r.id).join(', ')}`,
            },
          },
          { status: 400 },
        );
      }

      const actualCards = cardRefs.map(r => handMap.get(r.id)!);
      const actualCardIds = actualCards.map(c => c.id);

      // Run STT on the audio blob.
      let voiceMeta: VoiceMeta;
      try {
        const client = makeElevenLabsClient();
        const audioBuffer = base64ToBuffer(audioBase64);
        // Copy into a plain ArrayBuffer to satisfy the Blob constructor type.
        const plainArrayBuffer = new ArrayBuffer(audioBuffer.byteLength);
        new Uint8Array(plainArrayBuffer).set(audioBuffer);
        const audioBlob = new Blob([plainArrayBuffer], { type: 'audio/webm' });
        const metaFromAudio = await computeVoiceMetaFromAudio(audioBlob, client);
        voiceMeta = {
          latencyMs: metaFromAudio.latencyMs,
          fillerCount: metaFromAudio.fillerCount,
          pauseCount: metaFromAudio.pauseCount,
          speechRateWpm: metaFromAudio.speechRateWpm,
          lieScore: metaFromAudio.lieScore,
          // Parse the spoken claim from the transcript.
          parsed: parseClaim(metaFromAudio.transcript),
        };
      } catch {
        // STT failure is non-fatal — use fallback VoiceMeta.
        voiceMeta = {
          latencyMs: 0,
          fillerCount: 0,
          pauseCount: 0,
          speechRateWpm: 0,
          lieScore: 0,
          parsed: null,
        };
      }

      const currentRound = session.rounds[session.currentRoundIdx];
      if (!currentRound) {
        return Response.json(
          { error: { code: 'NO_ACTIVE_ROUND', message: 'No active round' } },
          { status: 400 },
        );
      }

      const claim: Claim = {
        by: 'player',
        count: actualCardIds.length as 1 | 2,
        claimedRank: currentRound.targetRank,
        actualCardIds,
        // truthState is derived (overwritten) by the FSM reducer — send honest as placeholder.
        truthState: 'honest',
        voiceMeta,
        claimText,
        timestamp: Date.now(),
      };

      // Fire ClaimMade — FSM derives truthState server-side.
      session = reduce(session, { type: 'ClaimMade', claim, now: Date.now() });

      // The claim is now appended to claimHistory. Build DecisionContext and
      // chain AI judgment inline (invariant 9 — response includes aiDecision).
      const updatedRound = session.rounds[session.currentRoundIdx];
      const decisionCtx = buildDecisionContext(session, updatedRound);
      const aiDecision = await aiDecideOnClaim(decisionCtx);

      // Fire the AI's chosen response on the FSM.
      if (aiDecision.action === 'challenge') {
        session = reduce(session, { type: 'ChallengeCalled', now: Date.now() });

        // Resolve the challenge: server knows the ground truth.
        const lastClaim = updatedRound.claimHistory[updatedRound.claimHistory.length - 1];
        const challengeWasCorrect = lastClaim?.truthState === 'lying';
        session = reduce(session, {
          type: 'RevealComplete',
          challengeWasCorrect,
          now: Date.now(),
        });
      } else {
        session = reduce(session, { type: 'ClaimAccepted', now: Date.now() });
      }

      // If either path ended a round, auto-chain RoundSettled + joker offer
      // so the client doesn't stall on a `round_over` state the FSM can't
      // advance without orchestration.
      session = autoChainRoundEnd(session);

      // Synthesize TTS for the AI's spoken judgment (voiceline). Uses the same
      // ElevenLabs Flash v2.5 pipeline as AiAct's claim TTS. Voice settings
      // come from the persona's "lying" preset for a challenge (AI is
      // accusing) and "honest" for an accept (AI is giving approval) — a
      // loose register mapping that gives challenge-lines more edge and
      // accept-lines more calm.
      const respondingPersona = session.ai.personaIfAi ?? 'Reader';
      let aiResponseAudioUrl = '';
      try {
        const ttsClient = makeElevenLabsClient();
        const voiceId = PERSONA_VOICE_IDS[respondingPersona];
        const voicePreset = VOICE_PRESETS[respondingPersona][
          aiDecision.action === 'challenge' ? 'lying' : 'honest'
        ];
        const audioStream = await ttsClient.textToSpeech.convert(voiceId, {
          text: aiDecision.voiceline,
          modelId: 'eleven_flash_v2_5',
          outputFormat: 'mp3_44100_128',
          voiceSettings: {
            stability: voicePreset.stability,
            similarityBoost: voicePreset.similarity_boost,
            style: voicePreset.style,
            speed: voicePreset.speed,
          },
        });
        aiResponseAudioUrl = await streamToDataUrl(
          audioStream as unknown as AsyncIterable<Uint8Array>,
        );
      } catch (err) {
        // TTS failure is non-fatal — client still shows the text + the
        // outcome banner still fires. Voiceline text survives for the
        // transcript even when audio bytes don't. Log the failure so it's
        // visible in server logs (instead of silently swallowed).
        console.error('[turn] Voiceline TTS failed:', err instanceof Error ? err.message : err);
        aiResponseAudioUrl = '';
      }

      await store.set(sessionId, session);

      return Response.json({
        session: toClientView(session, 'player'),
        aiDecision: {
          action: aiDecision.action,
          innerThought: aiDecision.innerThought,
        },
        aiResponse: {
          voiceline: aiDecision.voiceline,
          audioUrl: aiResponseAudioUrl,
          persona: respondingPersona,
        },
      });
    }

    // -----------------------------------------------------------------------
    // PlayerRespond
    // -----------------------------------------------------------------------
    if (body.type === 'PlayerRespond') {
      const { action } = body;

      if (action === 'accept') {
        session = reduce(session, { type: 'ClaimAccepted', now: Date.now() });
      } else {
        session = reduce(session, { type: 'ChallengeCalled', now: Date.now() });

        // Resolve: server knows ground truth.
        const currentRound = session.rounds[session.currentRoundIdx];
        const lastClaim = currentRound?.claimHistory[currentRound.claimHistory.length - 1];
        const challengeWasCorrect = lastClaim?.truthState === 'lying';
        session = reduce(session, {
          type: 'RevealComplete',
          challengeWasCorrect,
          now: Date.now(),
        });
      }

      // Auto-chain round-end → joker offer if the round just ended.
      session = autoChainRoundEnd(session);

      await store.set(sessionId, session);
      return Response.json({ session: toClientView(session, 'player') });
    }

    // -----------------------------------------------------------------------
    // AiAct
    // -----------------------------------------------------------------------
    if (body.type === 'AiAct') {
      const currentRound = session.rounds[session.currentRoundIdx];

      // Validate: only valid when activePlayer === 'ai' AND claim_phase.
      if (
        !currentRound ||
        currentRound.activePlayer !== 'ai' ||
        currentRound.status !== 'claim_phase'
      ) {
        return Response.json(
          {
            error: {
              code: 'INVALID_AI_ACT',
              message:
                "AiAct is only valid when round.activePlayer === 'ai' and round.status === 'claim_phase'",
            },
          },
          { status: 400 },
        );
      }

      const persona = session.ai.personaIfAi ?? 'Reader';

      // Build context + get AI's own-play decision.
      const ownPlayCtx = buildOwnPlayContext(session, currentRound);
      const aiPlay = await aiDecideOwnPlay(ownPlayCtx);

      // Synthesize TTS for the AI's claim text.
      let ttsAudioUrl = '';
      try {
        const client = makeElevenLabsClient();
        const voiceId = PERSONA_VOICE_IDS[persona];
        const voiceSettings = VOICE_PRESETS[persona][aiPlay.truthState];

        const audioStream = await client.textToSpeech.convert(voiceId, {
          text: aiPlay.claimText,
          modelId: 'eleven_flash_v2_5',
          outputFormat: 'mp3_44100_128',
          voiceSettings: {
            stability: voiceSettings.stability,
            similarityBoost: voiceSettings.similarity_boost,
            style: voiceSettings.style,
            speed: voiceSettings.speed,
          },
        });

        // Phase 1: return as data URL (no file system / storage required).
        ttsAudioUrl = await streamToDataUrl(
          audioStream as unknown as AsyncIterable<Uint8Array>,
        );
      } catch {
        // TTS failure is non-fatal — client will still show the claim text.
        ttsAudioUrl = '';
      }

      // Build the AI Claim object.
      const aiClaim: Claim = {
        by: 'ai',
        count: aiPlay.claim.count,
        claimedRank: currentRound.targetRank,
        actualCardIds: aiPlay.cardsToPlay.map(c => c.id),
        truthState: aiPlay.truthState,
        claimText: aiPlay.claimText,
        llmReasoning: aiPlay.llmReasoning,
        timestamp: Date.now(),
      };

      // Fire ClaimMade on the FSM.
      session = reduce(session, { type: 'ClaimMade', claim: aiClaim, now: Date.now() });

      await store.set(sessionId, session);

      return Response.json({
        session: toClientView(session, 'player'),
        aiClaim: {
          claimText: aiPlay.claimText,
          ttsAudioUrl,
          persona,
        },
      });
    }

    // -----------------------------------------------------------------------
    // PickJoker
    // -----------------------------------------------------------------------
    if (body.type === 'PickJoker') {
      const { joker } = body;

      if (session.status !== 'joker_offer') {
        return Response.json(
          {
            error: {
              code: 'INVALID_PICK_JOKER',
              message: `PickJoker only valid when session.status === 'joker_offer' (was '${session.status}')`,
            },
          },
          { status: 400 },
        );
      }

      if (!session.currentOffer?.offered.includes(joker)) {
        return Response.json(
          {
            error: {
              code: 'JOKER_NOT_OFFERED',
              message: `Joker '${joker}' was not in the current offer`,
            },
          },
          { status: 400 },
        );
      }

      // Deal the next round (both hands + deck + targetRank + activePlayer).
      const nextRoundDeal = dealFresh();

      session = reduce(session, {
        type: 'JokerPicked',
        joker,
        nextRoundDeal,
        now: Date.now(),
      });

      await store.set(sessionId, session);
      return Response.json({ session: toClientView(session, 'player') });
    }

    // Unknown event type.
    return Response.json(
      { error: { code: 'UNKNOWN_EVENT_TYPE', message: `Unknown event type: ${(body as { type: string }).type}` } },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return Response.json(
        { error: { code: 'INVALID_TRANSITION', message: err.message } },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: 'TURN_FAILED', message } },
      { status: 500 },
    );
  }
}
