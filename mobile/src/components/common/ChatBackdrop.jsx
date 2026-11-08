// The wallpaper behind every conversation (the chat, a support request): soft doodles over a plain colour, light or dark with the app's theme.
//   <ChatBackdrop> ...the messages... </ChatBackdrop>
// The tiles are drawn by scripts/make-chat-bg.js (original drawings). Change the colour or the doodles in ONE place, here and there, and every chat follows.
import React from 'react';
import { ImageBackground } from 'react-native';
import { useBrand } from './kit';

const BG_LIGHT = require('../../../assets/chat/chat_bg_light.png');
const BG_DARK = require('../../../assets/chat/chat_bg_dark.png');
export const CHAT_BG_COLOR = { light: '#EFE8DE', dark: '#0B1210' };

export default function ChatBackdrop({ children, style }) {
    const { dark } = useBrand();
    return (
        <ImageBackground source={dark ? BG_DARK : BG_LIGHT} resizeMode="repeat" style={[{ flex: 1, backgroundColor: dark ? CHAT_BG_COLOR.dark : CHAT_BG_COLOR.light }, style]}>
            {children}
        </ImageBackground>
    );
}
