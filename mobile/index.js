import { registerRootComponent } from 'expo';

// Defines the owner's background task (reading a new order out with the screen off). It has to be loaded first and at
// module scope: when the app is closed, Android starts only this JavaScript, and the task must already exist.
import './src/utils/owners/backgroundTask';

// The rider's live location while he delivers (foreground service). Same reason: defined at module scope.
import './src/utils/riders/locationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
