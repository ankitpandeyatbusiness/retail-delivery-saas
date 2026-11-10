// Web stand-in for expo-intent-launcher (opens Android screens: not possible in a browser)
export const startActivityAsync = async () => { throw new Error('Not available on the website'); };
export const ActivityAction = new Proxy({}, { get: (_, k) => String(k) });
