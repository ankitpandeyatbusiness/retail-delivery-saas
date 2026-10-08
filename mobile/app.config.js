// app.config.js
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
    bundleId: 'com.ankit.savera',
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
    bundleId: 'com.ankit.burgerking',
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

export default {
  expo: {
    name: currentConfig.name,
    slug: currentConfig.name.toLowerCase().replace(/\s+/g, '-'),
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
      // Preserves your previous manual permissions + adds Microphone
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.VIBRATE"
      ],
      ...(currentConfig.adaptiveIcon && { adaptiveIcon: currentConfig.adaptiveIcon }),
    },
    ios: {
      bundleIdentifier: currentConfig.bundleId,
    },
    extra: {
      tenantId: tenant,
    },
    plugins: [
      'expo-image',
      './plugins/withNoAutofillHighlight',
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