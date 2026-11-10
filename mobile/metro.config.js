// Metro config. Only the WEB build is changed: packages that exist only on a phone are swapped for harmless stand-ins
// in src/web/shims. The phone (Android/iOS) build is not touched by anything here.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const shim = (f) => path.join(__dirname, 'src', 'web', 'shims', f);
const WEB_ALIASES = {
  'react-native-maps': shim('maps.js'),
  'react-native-customui': shim('razorpay.js'),
  'expo-secure-store': shim('secureStore.js'),
  'expo-task-manager': shim('taskManager.js'),
  'expo-intent-launcher': shim('intentLauncher.js'),
  'react-native-blob-util': shim('blobUtil.js'),
  'expo-speech-recognition': shim('speechRecognition.js'),
  'expo-local-authentication': shim('localAuth.js'),
  'expo-screen-capture': shim('screenCapture.js'),
};

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ALIASES[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_ALIASES[moduleName] };
  }
  return (upstream || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
