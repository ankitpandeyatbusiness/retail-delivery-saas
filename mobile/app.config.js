// app.config.js
const fs = require('fs');
const tenant = process.env.APP_TENANT || 'default';

const tenantConfigs = {
  default: {
    name: 'Retail SaaS',
    bundleId: 'com.ankit.retailsaas',
    icon: './src/assets/tenants/default/icon.png',
    splashImage: './src/assets/tenants/default/icon.png',
    backgroundColor: '#ffffff',
    adaptiveIcon: null,
  },
  savera: {
    name: 'Savera',
    bundleId: 'com.savera.app',
    icon: './src/assets/tenants/savera/icon.png',
    splashImage: './src/assets/tenants/savera/adaptive-foreground.png',
    backgroundColor: '#E23744',
    adaptiveIcon: {
      foregroundImage: './src/assets/tenants/savera/adaptive-foreground.png',
      backgroundColor: '#E23744',
    },
  },
  burgerking: {
    name: 'Burger King',
    bundleId: 'com.burgerking.app',
    icon: './src/assets/tenants/default/icon.png',
    splashImage: './src/assets/tenants/default/icon.png',
    backgroundColor: '#D62300',
    adaptiveIcon: {
      foregroundImage: './src/assets/tenants/default/icon.png',
      backgroundColor: '#D62300',
    },
  },
};

if (!tenantConfigs[tenant]) {
  console.warn(`[app.config] Unknown APP_TENANT "${tenant}", falling back to "default"`);
}
const currentConfig = tenantConfigs[tenant] || tenantConfigs.default;

// Firebase (push) config belongs to ONE Android package. Use google-services.<tenant>.json when it exists,
// and the plain google-services.json only for the tenant whose package name it was made for (savera).
// A tenant with neither builds without push instead of failing the build.
const googleServicesFile = [`./google-services.${tenant}.json`, tenant === 'savera' ? './google-services.json' : null]
  .filter(Boolean).find((f) => fs.existsSync(f));

export default {
  expo: {
    name: currentConfig.name,
    slug: 'retail-delivery-customer',
    version: '1.0.0',
    orientation: 'portrait',
    icon: currentConfig.icon,
    splash: {
      image: currentConfig.splashImage,
      resizeMode: 'contain',
      backgroundColor: currentConfig.backgroundColor,
    },
    android: {
      config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } },
      package: currentConfig.bundleId,
      ...(googleServicesFile && { googleServicesFile }),
      // Preserves your previous manual permissions + adds Microphone
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.VIBRATE",
        "android.permission.POST_NOTIFICATIONS"
      ],
      ...(currentConfig.adaptiveIcon && { adaptiveIcon: currentConfig.adaptiveIcon }),
    },
    ios: {
      bundleIdentifier: currentConfig.bundleId,
    },
    extra: {
      tenantId: tenant,
      eas: { projectId: '863d0304-5faf-47cf-be8b-e69556ecb05e' },
    },
    plugins: [
      'expo-image',
      [
        'expo-build-properties',
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            buildArchs: ['arm64-v8a'],
            // Razorpay's SDK breaks in release builds without these (from its README)
            extraProguardRules: [
              '-keepattributes *Annotation*',
              '-dontwarn com.razorpay.**',
              '-keep class com.razorpay.** {*;}',
              '-optimizations !method/inlining/',
              '-keepclasseswithmembers class * { public void onPayment*(...); }',
            ].join('\n'),
          },
        },
      ],
      './plugins/withNoAutofillHighlight',
      './plugins/withUpiAppQueries',
      // Complaint photos: camera and gallery. No microphone.
      ['expo-image-picker', {
        photosPermission: 'Allow $(PRODUCT_NAME) to attach photos to your complaint.',
        cameraPermission: 'Allow $(PRODUCT_NAME) to take a photo for your complaint.',
        microphonePermission: false,
      }],
      // Push. defaultChannel must match the channel created in src/utils/push.js
      ['expo-notifications', { defaultChannel: 'orders', color: currentConfig.backgroundColor }],
      // Adds the Speech Recognition plugin with standard OS prompts
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'Allow $(PRODUCT_NAME) to access your microphone for voice search.',
          speechRecognitionPermission: 'Allow $(PRODUCT_NAME) to securely recognize your voice for search.'
        }
      ],
      // Adds the Location plugin based on your package.json
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Allow $(PRODUCT_NAME) to use your location.'
        }
      ]
    ]
  },
};