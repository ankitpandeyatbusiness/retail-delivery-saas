// Web stand-in for expo-local-authentication (fingerprint / face lock is not offered on the website)
export const hasHardwareAsync = async () => false;
export const isEnrolledAsync = async () => false;
export const getEnrolledLevelAsync = async () => 0;
export const supportedAuthenticationTypesAsync = async () => [];
export const authenticateAsync = async () => ({ success: false, error: 'not_available' });
export const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
export const SecurityLevel = { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 };
