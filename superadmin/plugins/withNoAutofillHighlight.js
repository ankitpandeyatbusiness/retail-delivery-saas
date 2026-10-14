const { withAndroidStyles } = require('@expo/config-plugins');

module.exports = function withNoAutofillHighlight(config) {
    return withAndroidStyles(config, (config) => {
        const styles = config.modResults;
        const appTheme = styles.resources.style.find((s) => s.$.name === 'AppTheme');

        if (appTheme) {
            const attr = 'android:autofilledHighlight';
            appTheme.item = (appTheme.item || []).filter((i) => i.$.name !== attr);
            appTheme.item.push({ $: { name: attr }, _: '@android:color/transparent' });
        }
        return config;
    });
};