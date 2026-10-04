// app.config.js
const tenant = process.env.APP_TENANT || 'default';

const tenantConfigs = {
  default: {
    name: "Retail SaaS",
    bundleId: "com.yourname.retailsaas",
    icon: "./src/assets/tenants/default/icon.png",
    backgroundColor: "#ffffff"
  },
  savera: {
    name: "Savera Delivery",
    bundleId: "com.yourname.savera",
    icon: "./src/assets/tenants/savera/icon.png",
    backgroundColor: "#F28C28" // Custom brand color for the splash screen
  }
};

const currentConfig = tenantConfigs[tenant
];

export default {
  expo: {
    name: currentConfig.name,
    slug: "retail-delivery-saas",
    version: "1.0.0",
    orientation: "portrait",
    icon: currentConfig.icon,
    splash: {
      image: currentConfig.icon,
      resizeMode: "contain",
      backgroundColor: currentConfig.backgroundColor
    },
    android: {
      package: currentConfig.bundleId
    },
    ios: {
      bundleIdentifier: currentConfig.bundleId
    }
  }
};