// Retail Control: the platform owner's app. It is NOT tied to any shop (no tenant id).
const fs = require('fs');
const palette = require('./src/theme/palette');
// push alerts need Firebase: put google-services.json (for com.ankitpandey.retailcontrol) next to this file
const hasFirebase = fs.existsSync('./google-services.json');
// It talks only to /api/admin on the backend; EXPO_PUBLIC_BASE_URL must be https in a release build.
module.exports = {
    expo: {
        name: 'Retail Control',
        slug: 'retail-control',
        version: '1.0.0',
        orientation: 'portrait',
        scheme: 'retailcontrol',
        userInterfaceStyle: 'automatic',
        icon: './assets/icon.png',
        android: {
            package: 'com.ankitpandey.retailcontrol',
            allowBackup: false,
            ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
            adaptiveIcon: {
                foregroundImage: './assets/adaptive-foreground.png',
                backgroundImage: './assets/adaptive-background.png',
            },
        },
        ios: {
            bundleIdentifier: 'com.ankitpandey.retailcontrol',
        },
        plugins: [
            'expo-secure-store',
            // no coloured box on autofilled fields (phone number, OTP). Written into the Android theme on every prebuild.
            './plugins/withNoAutofillHighlight',
            ['expo-notifications', { defaultChannel: 'alerts', color: palette.brand.gradient[1] }],
            ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 260, backgroundColor: palette.brand.gradient[1] }],
        ],
    },
};
