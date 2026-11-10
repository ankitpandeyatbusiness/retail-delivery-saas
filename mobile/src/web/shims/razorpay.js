// Web stand-in for react-native-customui (the Razorpay native checkout). Phase 5 builds the real web checkout.
// Until then a payment on web fails with a clear message instead of crashing.
const unavailable = async () => { throw { code: 'WEB_UNAVAILABLE', description: 'Online payment on the website is coming soon. Please use the app.' }; };
const Razorpay = {
    open: unavailable,
    initRazorpay: async () => {},
    getAppsWhichSupportUPI: async () => [],
    getPaymentMethods: async () => ({}),
};
export default Razorpay;
