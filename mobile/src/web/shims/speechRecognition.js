// Web stand-in for expo-speech-recognition (voice search: app only for now)
const denied = async () => ({ granted: false, status: 'denied', canAskAgain: false, expires: 'never' });
export const ExpoSpeechRecognitionModule = {
    requestPermissionsAsync: denied, getPermissionsAsync: denied,
    start: () => {}, stop: () => {}, abort: () => {}, isRecognitionAvailable: () => false,
};
export const useSpeechRecognitionEvent = () => {};
