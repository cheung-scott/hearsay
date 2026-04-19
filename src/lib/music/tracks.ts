// Track-URL resolver — centralizes missing-track detection.
//
// Returns `null` for either missing entry or empty URL — both surface the
// music-disabled path (see useMusicBed §6.6 / spec §8 I5).

import type { MusicTrack } from '@/lib/game/types';
import type { TensionLevel } from './tension';

export function getTrackUrl(
  tracks: MusicTrack[] | undefined,
  level: TensionLevel,
): string | null {
  if (!tracks || tracks.length === 0) return null;
  const match = tracks.find(t => t.level === level);
  if (!match || !match.url) return null;
  return match.url;
}

/** All three TensionLevel slots have a non-empty URL. */
export function hasAllTracks(tracks: MusicTrack[] | undefined): boolean {
  return (
    getTrackUrl(tracks, 'calm') !== null &&
    getTrackUrl(tracks, 'tense') !== null &&
    getTrackUrl(tracks, 'critical') !== null
  );
}
