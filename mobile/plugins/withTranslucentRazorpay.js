// Razorpay's payment screen (RazorpayPaymentActivity) opens on top of the app. With a transparent theme the app's own
// screen stays visible behind it, so the customer sees the app's "Opening <UPI app>" screen instead of a blank
// Razorpay page. The page itself is hidden by patches/react-native-customui+*.patch (webview alpha 0).
const { withAndroidManifest } = require('@expo/config-plugins');

const ACTIVITY = 'com.razorpay.rn.custom.RazorpayPaymentActivity';

module.exports = function withTranslucentRazorpay(config) {
    return withAndroidManifest(config, (c) => {
        const manifest = c.modResults.manifest;
        manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
        const app = manifest.application[0];
        app.activity = app.activity || [];
        let act = app.activity.find((a) => a.$['android:name'] === ACTIVITY);
        if (!act) {
            act = { $: { 'android:name': ACTIVITY } };
            app.activity.push(act);
        }
        act.$['android:theme'] = '@android:style/Theme.Translucent.NoTitleBar';
        act.$['tools:replace'] = 'android:theme';
        return c;
    });
};
