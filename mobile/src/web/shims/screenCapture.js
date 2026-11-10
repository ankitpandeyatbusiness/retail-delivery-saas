// Web stand-in for expo-screen-capture (a browser cannot block screenshots)
export const preventScreenCaptureAsync = async () => {};
export const allowScreenCaptureAsync = async () => {};
export const usePreventScreenCapture = () => {};
export const isAvailableAsync = async () => false;
export const addScreenshotListener = () => ({ remove() {} });
