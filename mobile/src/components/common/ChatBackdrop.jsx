// The wallpaper behind every conversation (the chat, a support request): soft doodles over a plain colour, light or dark with the app's theme.
//   <ChatBackdrop> ...the messages... </ChatBackdrop>
// The tiles are drawn by scripts/make-chat-bg.js (original drawings). Change the colour or the doodles in ONE place, here and there, and every chat follows.
import React from 'react';
import { ImageBackground, useWindowDimensions } from 'react-native';
import { useBrand } from './kit';

const BG_LIGHT = require('../../../assets/chat/chat_bg_light.png');
const BG_DARK = require('../../../assets/chat/chat_bg_dark.png');
// the wide pair (made by scripts/make-chat-bg.js): shown when the window is wider than it is tall (a phone turned sideways, the website), with food among the doodles
const BG_LAND_LIGHT = require('../../../assets/chat/chat_bg_land_light.png');
const BG_LAND_DARK = require('../../../assets/chat/chat_bg_land_dark.png');
export const CHAT_BG_COLOR = { light: '#EFE8DE', dark: '#0B1210' };

export default function ChatBackdrop({ children, style }) {
    const { dark } = useBrand();
    const { width, height } = useWindowDimensions();
    const landscape = width > height;
    return (
        <ImageBackground source={landscape ? (dark ? BG_LAND_DARK : BG_LAND_LIGHT) : (dark ? BG_DARK : BG_LIGHT)} resizeMode="repeat" style={[{ flex: 1, backgroundColor: dark ? CHAT_BG_COLOR.dark : CHAT_BG_COLOR.light }, style]}>
            {children}
        </ImageBackground>
    );
}
