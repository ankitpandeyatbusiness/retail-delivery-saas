// app.config.js
// Expo does not allow an async config, so the icon and splash are downloaded by a small script
// (scripts/fetch-branding.js) that this file runs and waits for.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const tenant = process.env.APP_TENANT || 'default';

// Name, package and colour of each shop's app. The pictures come from the media bucket, not from this repo.
const tenantConfigs = {
  default: {
    name: 'Retail SaaS',
    bundleId: 'com.ankit.retailsaas',
    backgroundColor: '#ffffff',
  },
  savera: {
    name: 'Savera',
    bundleId: 'com.savera.app',
    backgroundColor: '#E23744',
  },
  burgerking: {
    name: 'Burger King',
    bundleId: 'com.burgerking.app',
    backgroundColor: '#D62300',
  },
};

if (!tenantConfigs[tenant]) {
  console.warn(`[app.config] Unknown APP_TENANT "${tenant}", falling back to "default"`);
}
const currentConfig = tenantConfigs[tenant] || tenantConfigs.default;
const isDefaultApp = tenant === 'default';

// No picture is kept in this repo. Every app uses the files in its bucket folder:
//   a shop:             tenants/<slug>/branding/{icon.png, adaptive-foreground.png, splash.png}
//   the default app:    defaults/branding/icon.png  (also the fallback when BRANDING_OPTIONAL=1)
function loadBranding(slug) {
  const dir = path.join(__dirname, '.branding-cache', slug);
  let found = {};
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'scripts', 'fetch-branding.js'), slug, dir], {
      encoding: 'utf8',
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'inherit'],   // the script's own messages show in the build log
    });
    found = JSON.parse(out || '{}');
  } catch (e) {
    console.warn(`[app.config] Could not fetch branding for "${slug}": ${e.message}`);
  }
  const rel = (name) => (name && fs.existsSync(path.join(dir, name)) ? `./.branding-cache/${slug}/${name}` : null);
  return { icon: rel(found.icon), adaptive: rel(found.adaptive), splash: rel(found.splash) };
}

let b = loadBranding(isDefaultApp ? 'default' : tenant);
if (!b.icon && !isDefaultApp) {
  if (process.env.BRANDING_OPTIONAL !== '1') {
    // Never build a shop's app with another shop's (or the default) icon by accident
    throw new Error(
      `No app icon found for "${tenant}". Upload it to <bucket>/tenants/${tenant}/branding/icon.png ` +
      `(kind "icon" in the upload API) and set MEDIA_CDN_URL. Set BRANDING_OPTIONAL=1 to build with the default icon.`
    );
  }
  b = loadBranding('default');
}
if (!b.icon) {
  throw new Error(
    `No app icon found. Check MEDIA_CDN_URL and that <bucket>/defaults/branding/icon.png exists ` +
    `(upload it with: cd backend && node src/scripts/uploadTenantBranding.js default <folder with icon.png>).`
  );
}
const icon = b.icon;
const adaptiveForeground = b.adaptive || icon;
const splashImage = b.splash || b.adaptive || icon;

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
    // lets the app know when the phone is in dark mode (Account → Appearance → System). Without this, Android always
    // reports light. Needs expo-system-ui and a new native build; an OTA update alone does not change it.
    userInterfaceStyle: 'automatic',
    icon,
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
      // the default app has no adaptive icon (as before); every shop gets one
      ...(tenant !== 'default' && {
        adaptiveIcon: { foregroundImage: adaptiveForeground, backgroundColor: currentConfig.backgroundColor },
      }),
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
      // the one splash screen: brand colour + logo. App.js keeps it up until the shop's look and the login state
      // are ready, then fades it out, so there is no black screen and no second loader.
      ['expo-splash-screen', {
        backgroundColor: currentConfig.backgroundColor,
        image: splashImage,
        imageWidth: 180,
        resizeMode: 'contain',
      }],
      './plugins/withNoAutofillHighlight',
      './plugins/withUpiAppQueries',
      './plugins/withTranslucentRazorpay',   // Razorpay's screen is see-through: the app's own screen shows while it works
      // Complaint photos: camera and gallery.
      // Do NOT set microphonePermission: false here: it strips RECORD_AUDIO from the manifest,
      // and voice search (expo-speech-recognition below) then never gets a permission prompt.
      ['expo-image-picker', {
        photosPermission: 'Allow $(PRODUCT_NAME) to attach photos to your complaint.',
        cameraPermission: 'Allow $(PRODUCT_NAME) to take a photo for your complaint.',
      }],
      // Push. defaultChannel must match the channel created in src/utils/common/push.js
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
