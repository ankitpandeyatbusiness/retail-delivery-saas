// app.config.js
// Expo does not allow an async config, so the icon and splash are downloaded by a small script
// (scripts/fetch-branding.js) that this file runs and waits for.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const tenant = process.env.APP_TENANT || 'default';

// Name, package and colour of each shop's app. The pictures come from the media bucket, not from this repo.
const tenantConfigs = require('./tenants');   // the one list of shops (also read by scripts/release.js)

// Released through scripts/release.js (or an EAS build): a wrong shop name or a local server address stops here.
const guarded = process.env.RELEASE_GUARD === '1' || !!process.env.EAS_BUILD;
if (guarded) {
  if (!tenantConfigs[tenant] || tenant === 'default') {
    throw new Error('[release guard] APP_TENANT "' + tenant + '" is not a shop in tenants.js.');
  }
  if (process.env.RELEASE_SLUG && process.env.RELEASE_SLUG !== tenant) {
    throw new Error('[release guard] APP_TENANT and the shop you chose do not match.');
  }
  const prof = process.env.EAS_BUILD_PROFILE;
  if (prof && !prof.startsWith(tenant + '-')) {
    throw new Error('[release guard] build profile "' + prof + '" is not for shop "' + tenant + '".');
  }
  // Only on the EAS build server, where the real (EAS-hosted) value is in place. On your own machine eas-cli reads
  // this config BEFORE it has loaded the EAS environment, so the value seen here is not the one that gets built.
  if (process.env.EAS_BUILD) {
    const api = process.env.EXPO_PUBLIC_BASE_URL || '';
    if (!/^https:\/\//.test(api) || /ngrok|localhost|127\.0\.0\.1|192\.168\.|\b10\.\d+\.\d+\.\d+/.test(api)) {
      throw new Error('[release guard] EXPO_PUBLIC_BASE_URL is "' + (api || 'empty') + '": a release must use the live https server, not a local or tunnel address.');
    }
  }
}

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
    // OTA updates (eas update). A build only receives updates made for the same app version (1.0.0), and only from
    // the channel set in eas.json for that build, so each shop's app gets only its own updates.
    runtimeVersion: { policy: 'appVersion' },
    updates: { url: 'https://u.expo.dev/863d0304-5faf-47cf-be8b-e69556ecb05e' },
    orientation: 'portrait',
    // the app link a table QR opens: <shop>://table/7?k=... (needs a new native build)
    scheme: tenant === 'default' ? 'retailsaas' : tenant,
    // lets the app know when the phone is in dark mode (Account → Appearance → System). Without this, Android always
    // reports light. Needs expo-system-ui and a new native build; an OTA update alone does not change it.
    userInterfaceStyle: 'automatic',
    icon,
    android: {
      config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_SDK_KEY || process.env.GOOGLE_MAPS_API_KEY } },   // the app's own Maps key (restricted to the app); GOOGLE_MAPS_API_KEY is the older name
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
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION"
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
      ['expo-camera', { cameraPermission: 'Allow the camera to scan the QR code on your table.', recordAudioAndroidPermission: false }],
      [
        'expo-build-properties',
        {
          android: {
            enableProguardInReleaseBuilds: true,
            // OFF on purpose: the resource shrinker deleted res/raw/new_order.wav (the new-order notification sound), which the
            // app only looks up by name at run time, and the notification then played the phone's normal ping.
            // (plugins/withKeepSounds.js also writes a keep rule, but switching the shrinker off cannot go wrong.)
            enableShrinkResourcesInReleaseBuilds: false,
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
      './plugins/withKeepSounds',            // a release build must not strip the new-order sound (it is only looked up by name)
      // Complaint photos: camera and gallery.
      // Do NOT set microphonePermission: false here: it strips RECORD_AUDIO from the manifest,
      // and voice search (expo-speech-recognition below) then never gets a permission prompt.
      ['expo-image-picker', {
        photosPermission: 'Allow $(PRODUCT_NAME) to attach photos to your complaint.',
        cameraPermission: 'Allow $(PRODUCT_NAME) to take a photo for your complaint.',
      }],
      // Push. defaultChannel must match the channel created in src/utils/common/push.js
      // sounds: bundled into the app so the owner's "new_orders" channel can play the voice clip "New order received"
      // even when the app is closed (a push can only play a sound that is already inside the app).
      ['expo-notifications', {
        defaultChannel: 'orders',
        color: currentConfig.backgroundColor,
        sounds: ['./assets/sounds/new_order.wav', './assets/sounds/ting_tong.wav', './assets/sounds/notify.wav', './assets/sounds/cancel_alert.wav', './assets/sounds/help_alarm.wav'],
      }],
      // Soundbox mode: the owner's phone keeps repeating the new-order sound and speaks the order with the screen off.
      // Background playback adds Android's media-playback foreground service, which keeps the app alive while it plays.
      ['expo-audio', { enableBackgroundPlayback: true }],
      // Adds the Speech Recognition plugin with standard OS prompts
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'Allow $(PRODUCT_NAME) to access your microphone for voice search.',
          speechRecognitionPermission: 'Allow $(PRODUCT_NAME) to securely recognize your voice for search.'
        }
      ],
      'expo-local-authentication',   // the app lock: fingerprint, face or the phone's own screen lock (adds the biometric permission)
      // Adds the Location plugin based on your package.json
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Allow $(PRODUCT_NAME) to use your location while you deliver, so customers can see where you are even when the screen is off.',
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true
        }
      ]
    ]
  },
};
