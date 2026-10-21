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
        version: '1.1.0',
        owner: 'retail-delivery-saass-team',
        extra: { eas: { projectId: 'a555451d-87ad-4029-996c-84f50a62fc17' } },
        // OTA updates (eas update): a build only receives updates made for the same app version
        runtimeVersion: { policy: 'appVersion' },
        updates: { url: 'https://u.expo.dev/a555451d-87ad-4029-996c-84f50a62fc17' },
        orientation: 'portrait',
        scheme: 'retailcontrol',
        userInterfaceStyle: 'automatic',
        backgroundColor: '#FFFFFF',   // the window behind the app: white, not the splash blue
        icon: './assets/icon.png',
        android: {
            package: 'com.ankitpandey.retailcontrol',
            allowBackup: false,
            // Google Maps SDK key (put GOOGLE_MAPS_SDK_KEY=... in superadmin/.env; the older name GOOGLE_MAPS_API_KEY also works): the map where you point to the shop
            config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_SDK_KEY || process.env.GOOGLE_MAPS_API_KEY } },
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
            ['expo-location', { locationWhenInUsePermission: 'Allow Retail Control to use your location to point to a shop on the map.' }],
            // no coloured box on autofilled fields (phone number, OTP). Written into the Android theme on every prebuild.
            './plugins/withNoAutofillHighlight',
            ['expo-notifications', { defaultChannel: 'alerts', color: palette.brand.gradient[1] }],
            ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 260, backgroundColor: palette.brand.gradient[1] }],
        ],
    },
};
