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
      package: currentConfig.bundleId,
      ...(currentConfig.adaptiveIcon && { adaptiveIcon: currentConfig.adaptiveIcon }),
    },
    ios: {
      bundleIdentifier: currentConfig.bundleId,
    },
    plugins: [
      'expo-image'
    ]
  },
};