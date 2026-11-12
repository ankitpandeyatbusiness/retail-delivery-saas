// src/components/common/typography.js
//
// Real fonts for the shop's "font style" setting.
//   modern  = Inter   (only when the shop's look is not "bold": bold keeps the phone's own font, as before)
//   classic = Lora    (a serif, for sweet shops and bakeries)
//   rounded = Nunito  (friendly, for juice bars and cafes)
//
// React Native has no global default font, and Text is a plain function component, so the one place to set a font
// for the whole app is the `Text` export itself. When a family is active we swap `Text` / `TextInput` / `Animated.Text`
// for versions that pick the right weight of the family from style.fontWeight (Android needs one font file per weight).
// A Text that sets its own fontFamily (the icon fonts) is left alone. If anything fails the app keeps the system font.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Platform } from 'react-native';
import * as Font from 'expo-font';
import { isOwnerDeskNow } from '../../utils/common/layout';

// each weight is its own file, so only these are bundled (not every weight of the family)
const FAMILIES = {
    modern: () => ({
        400: ['Inter_400Regular', require('@expo-google-fonts/inter/400Regular').Inter_400Regular],
        500: ['Inter_500Medium', require('@expo-google-fonts/inter/500Medium').Inter_500Medium],
        600: ['Inter_600SemiBold', require('@expo-google-fonts/inter/600SemiBold').Inter_600SemiBold],
        700: ['Inter_700Bold', require('@expo-google-fonts/inter/700Bold').Inter_700Bold],
        800: ['Inter_800ExtraBold', require('@expo-google-fonts/inter/800ExtraBold').Inter_800ExtraBold],
    }),
    classic: () => ({
        400: ['Lora_400Regular', require('@expo-google-fonts/lora/400Regular').Lora_400Regular],
        500: ['Lora_500Medium', require('@expo-google-fonts/lora/500Medium').Lora_500Medium],
        600: ['Lora_600SemiBold', require('@expo-google-fonts/lora/600SemiBold').Lora_600SemiBold],
        700: ['Lora_700Bold', require('@expo-google-fonts/lora/700Bold').Lora_700Bold],
    }),
    rounded: () => ({
        400: ['Nunito_400Regular', require('@expo-google-fonts/nunito/400Regular').Nunito_400Regular],
        600: ['Nunito_600SemiBold', require('@expo-google-fonts/nunito/600SemiBold').Nunito_600SemiBold],
        700: ['Nunito_700Bold', require('@expo-google-fonts/nunito/700Bold').Nunito_700Bold],
        800: ['Nunito_800ExtraBold', require('@expo-google-fonts/nunito/800ExtraBold').Nunito_800ExtraBold],
    }),
};

// which family a shop gets (null = leave the system font alone)
export const familyFor = (fontStyle, look) => {
    if (fontStyle === 'classic' || fontStyle === 'rounded') return fontStyle;
    return look && look !== 'bold' ? 'modern' : null;
};

let installed = false;

// The owner panel on a computer is written with very heavy weights (900 and 800 on headings, names, buttons and small labels): fine on a phone,
// but a wall of bold on a wide screen. There they are drawn a step or two lighter: 900 -> 700, 800 -> 600, 700 -> 600, 600 -> 500.
const lighter = (w) => (w >= 900 ? 700 : w >= 800 ? 600 : w >= 700 ? 600 : w >= 600 ? 500 : w);

const weightOf = (w) => {
    if (w === 'bold') return 700;
    if (w === 'normal' || w === undefined || w === null) return 400;
    const n = parseInt(w, 10);
    return Number.isFinite(n) ? n : 400;
};

// Loads the family and swaps the Text components. Resolves true when the app now draws with it.
export async function applyTypography(fontStyle, look) {
    const own = familyFor(fontStyle, look);
    const ownerOnly = !own && Platform.OS === 'web';   // the shop keeps the phone's own font, but the website's owner panel gets Inter, lighter
    const key = own || (ownerOnly ? 'modern' : null);
    if (!key || installed) return false;
    try {
        const files = FAMILIES[key]();
        const weights = Object.keys(files).map(Number).sort((a, b) => a - b);
        const names = {};
        weights.forEach((w) => { names[w] = files[w][0]; });
        await Font.loadAsync(Object.fromEntries(weights.map((w) => files[w])));

        // the heaviest file that is not heavier than the requested weight (800 with no 800 file -> 700)
        const pick = (w) => {
            let best = weights[0];
            weights.forEach((x) => { if (x <= w) best = x; });
            return names[best];
        };

        const RN = require('react-native');
        const Base = { Text: RN.Text, TextInput: RN.TextInput };
        const wrap = (Comp) => function FontComp({ style, ...rest }) {
            const flat = StyleSheet.flatten(style) || {};
            // Inter, Lora and Nunito have only Latin letters: in Hindi, Marathi, Gujarati, Bengali or Bhojpuri the phone's own
            // font is used, which has these scripts in every weight (a Latin-only family would make bold text thin)
            if (flat.fontFamily || require('../../i18n').getLang() !== 'en') return <Comp style={style} {...rest} />;
            const owner = Platform.OS === 'web' && isOwnerDeskNow();   // the owner panel on a computer: lighter weights
            if (ownerOnly && !owner) return <Comp style={style} {...rest} />;   // everyone else keeps the shop's own font, as before
            const w = weightOf(flat.fontWeight);
            return <Comp {...rest} style={[style, { fontFamily: pick(owner ? lighter(w) : w), fontWeight: 'normal' }]} />;
        };
        const FText = wrap(Base.Text);
        const FInput = wrap(Base.TextInput);
        const put = (obj, prop, value) => Object.defineProperty(obj, prop, { configurable: true, enumerable: true, get: () => value });
        put(RN, 'Text', FText);
        put(RN, 'TextInput', FInput);
        try { put(RN.Animated, 'Text', RN.Animated.createAnimatedComponent(FText)); } catch (e) { /* Animated.Text keeps the system font */ }
        installed = true;
        return true;
    } catch (e) {
        return false;   // keep the system font
    }
}
