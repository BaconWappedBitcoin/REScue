/**
 * Notice settings (RES notifications options): how long notices stay, and which notice types
 * you muted with "don't show again". Remove an entry from the muted list to see that notice again.
 * The notice framework itself is src/core/notices.ts; content.ts wires it to these options.
 */
import { setOption, type SettingsProfile } from '../../core/settings';
import { defineModule } from '../../core/types';

export const noticeSettings = defineModule({
  id: 'noticeSettings',
  category: 'core',
  title: 'Notices',
  description:
    'How long REScue’s pop-up notices stay open, and which ones you muted. A notice stays open while the pointer is over it.',
  enabledByDefault: true,
  locked: true,
  options: {
    closeDelaySeconds: {
      type: 'number',
      default: 0,
      min: 0,
      max: 120,
      title: 'Close info notices after (seconds)',
      description:
        '0 keeps them open until you close them. Warnings and errors never close by themselves. A few info notices (such as “paused after N pages”) close after their own short time whatever you set here; this applies to the others.',
    },
    fadeOutSeconds: {
      type: 'number',
      default: 1,
      min: 0,
      max: 30,
      title: 'Fade a closing notice out over (seconds)',
      description:
        'A notice that closes by itself fades for this long first (RES: 3). 0 removes it at once. Moving the pointer onto it during the fade brings it back.',
    },
    mutedTypes: {
      type: 'list',
      default: [],
      title: 'Muted notices',
      description:
        'Notice types you chose “Don’t show this again” for, one per line. Delete a line to see that notice again.',
    },
  },
});

export interface NoticePrefs {
  closeDelaySeconds: number;
  fadeOutSeconds: number;
  mutedTypes: string[];
}

export function readNoticePrefs(profile: SettingsProfile): NoticePrefs {
  const o = profile.modules.noticeSettings?.options ?? {};
  const delay = o.closeDelaySeconds;
  const muted = o.mutedTypes;
  const fade = o.fadeOutSeconds;
  return {
    closeDelaySeconds: typeof delay === 'number' && delay > 0 ? delay : 0,
    fadeOutSeconds: typeof fade === 'number' && fade >= 0 ? fade : 1,
    mutedTypes: Array.isArray(muted) ? muted.filter((m): m is string => typeof m === 'string') : [],
  };
}

export function withMutedTypes(profile: SettingsProfile, muted: string[]): SettingsProfile {
  return setOption(profile, noticeSettings, 'mutedTypes', muted);
}
