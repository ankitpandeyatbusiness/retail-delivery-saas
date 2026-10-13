const { withAndroidManifest } = require('@expo/config-plugins');

// Android 11+ hides other installed apps unless the manifest says what we may look for.
// Razorpay's SDK lists UPI apps by asking Android who can open "upi://pay", so that intent must be declared.
module.exports = function withUpiAppQueries(config) {
    return withAndroidManifest(config, (config) => {
        const manifest = config.modResults.manifest;
        manifest.queries = manifest.queries || [];
        const q = manifest.queries[0] || (manifest.queries[0] = {});
        q.intent = q.intent || [];

        const has = q.intent.some((i) => (i.data || []).some((d) => d.$['android:scheme'] === 'upi'));
        if (!has) {
            q.intent.push({
                action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
                data: [{ $: { 'android:scheme': 'upi', 'android:host': 'pay' } }],
            });
        }
        return config;
    });
};
