// Keeps the bundled notification sound inside RELEASE builds.
//
// The new-order push plays res/raw/new_order.wav. The app only asks for it by name at run time (Android looks the file up
// with getIdentifier), so Android's resource shrinker, which is switched on for release builds in app.config.js, sees no
// reference to it and throws it away. The notification then falls back to the phone's normal ping. A keep.xml tells the
// shrinker to leave res/raw alone ("@raw/*": the only files there are our sounds). Debug builds do not shrink, which is
// why this only ever shows in a release build.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

module.exports = function withKeepSounds(config) {
    return withDangerousMod(config, ['android', async (c) => {
        const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'keep.xml'),
            '<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@raw/*" />\n',
        );
        return c;
    }]);
};
