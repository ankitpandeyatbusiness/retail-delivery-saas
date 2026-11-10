// The app's useFocusEffect: exactly React Navigation's (the effect runs when the screen comes into view and cleans up when it leaves),
// and it also runs AGAIN while the screen is in view whenever another device of this person changed something (useSyncStore.tick, bumped by
// utils/common/syncEvents.js). So every screen that loads its data on focus shows a change made elsewhere without being left and re-opened.
import { useCallback } from 'react';
import { useFocusEffect as navFocusEffect } from '@react-navigation/native';
import { useSyncStore } from '../../store/common/useSyncStore';

export function useFocusEffect(effect) {
    const tick = useSyncStore((s) => s.tick);
    // a new tick makes a new callback, which React Navigation runs again (cleaning up the previous run first)
    const live = useCallback(() => effect(), [effect, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
    return navFocusEffect(live);
}
