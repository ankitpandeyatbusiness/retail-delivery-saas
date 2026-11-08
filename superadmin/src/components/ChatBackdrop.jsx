// The wallpaper behind a conversation: soft doodles over a plain colour, light or dark with the app's theme (the same pictures as the customer app).
//   <ChatBackdrop style={{ borderRadius: 16, overflow: 'hidden', padding: 12 }}> ...the messages... </ChatBackdrop>      fill = take all the room (a screen of its own)
import React from 'react';
import { ImageBackground } from 'react-native';
import { useTheme } from '../theme';

const BG_LIGHT = require('../../assets/chat/chat_bg_light.png');
const BG_DARK = require('../../assets/chat/chat_bg_dark.png');

export default function ChatBackdrop({ children, style, fill }) {
    const t = useTheme();
    return (
        <ImageBackground source={t.dark ? BG_DARK : BG_LIGHT} resizeMode="repeat" style={[fill ? { flex: 1 } : null, { backgroundColor: t.dark ? '#0B1210' : '#EFE8DE' }, style]}>
            {children}
        </ImageBackground>
    );
}
