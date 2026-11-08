// How the phone's ringer is set: 'normal' | 'vibrate' | 'silent'. Android only (a small native module, modules/ringer-mode).
// Anywhere else, or in a build made before this module existed, it answers 'normal', so nothing changes there.
import { requireOptionalNativeModule } from 'expo-modules-core';

const Native = requireOptionalNativeModule<{ getMode(): 'normal' | 'vibrate' | 'silent' }>('RingerMode');

export const getRingerMode = (): 'normal' | 'vibrate' | 'silent' => {
  try { return Native ? Native.getMode() : 'normal'; } catch (e) { return 'normal'; }
};
export const isPhoneQuiet = (): boolean => getRingerMode() !== 'normal';
