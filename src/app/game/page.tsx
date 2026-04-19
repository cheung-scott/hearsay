import { GameSession } from '@/components/game/GameSession';

/**
 * Game page — server component shell.
 * Phase 1: no server-side session fetching; client handles CreateSession via useGameSession.
 */
export default function GamePage() {
  return <GameSession />;
}
