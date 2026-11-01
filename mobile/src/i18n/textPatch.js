// A safety net for texts that are not wrapped in tr(): lists written at the top of a file (status names, months, filter names), and
// messages that come from the server. Text and TextInput are swapped for versions that translate a plain string child (and a
// placeholder) when there is a translation for exactly that English text. Everything else is drawn unchanged.
// It is installed once, at start (App.js). typography.js swaps Text again later and wraps this one, so the two work together.
import React from 'react';
import * as RN from 'react-native';
import { tr, getLang } from './index';
import { localizeDatesInText, localizeDateOutput } from './dates';

let installed = false;

const tx = (c) => (typeof c === 'string' ? localizeDatesInText(tr(c)) : Array.isArray(c) ? c.map(tx) : c);
const put = (obj, prop, value) => Object.defineProperty(obj, prop, { configurable: true, enumerable: true, get: () => value });

export function installTextTranslation() {
    if (installed) return;
    installed = true;
    try {
        // every date the app prints (Date.toLocale...) has its month, day and AM/PM words in the person's language
        for (const fn of ['toLocaleDateString', 'toLocaleString', 'toLocaleTimeString']) {
            const original = Date.prototype[fn];
            Date.prototype[fn] = function localized(...args) { return localizeDateOutput(original.apply(this, args)); };   // eslint-disable-line no-extend-native
        }
        const BaseText = RN.Text;
        const BaseInput = RN.TextInput;
        const TText = React.forwardRef(function TText({ children, ...rest }, ref) {
            // a one-line text in another language is often longer than the English it was laid out for: it shrinks a little
            // (to 80%) to fit, instead of being cut with "..." (a screen that already chose its own fitting keeps it)
            const fit = rest.numberOfLines === 1 && rest.adjustsFontSizeToFit === undefined && getLang() !== 'en'
                ? { adjustsFontSizeToFit: true, minimumFontScale: 0.8 } : null;
            return <BaseText ref={ref} {...fit} {...rest}>{tx(children)}</BaseText>;
        });
        const TInput = React.forwardRef(function TInput({ placeholder, ...rest }, ref) {
            return <BaseInput ref={ref} {...rest} placeholder={typeof placeholder === 'string' ? tr(placeholder) : placeholder} />;
        });
        put(RN, 'Text', TText);
        put(RN, 'TextInput', TInput);
        try { put(RN.Animated, 'Text', RN.Animated.createAnimatedComponent(TText)); } catch (e) { /* Animated.Text stays as it is */ }
    } catch (e) { installed = false; /* the app works, texts just are not translated by the net */ }
}
