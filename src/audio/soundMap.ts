import type { SoundId } from './soundBus';

/**
 * Put audio files in /public/sfx and list them here, e.g.
 *   deal: '/sfx/deal.mp3',
 * App registers everything in this map on startup.
 */
export const SOUND_FILES: Partial<Record<SoundId, string>> = {};
