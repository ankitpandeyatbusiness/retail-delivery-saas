import { registerRootComponent } from 'expo';

// The rider's live location while he delivers (foreground service). Same reason: defined at module scope.
import './src/utils/riders/locationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
