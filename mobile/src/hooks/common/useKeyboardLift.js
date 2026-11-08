// Lifts a screen's bottom (the message box of a chat) above the keyboard, smoothly, with the keyboard.
//   const lift = useKeyboardLift();     <Animated.View style={[{ flex: 1 }, lift]}> ... the list and the input ... </Animated.View>
// Why not KeyboardAvoidingView: the app draws edge to edge, so on Android the window is not resized when the keyboard opens and the keyboard covers the input.
// Same method as the login screen: the keyboard height only counts while the keyboard is really opening, open or closing, and never more than 60% of the screen
// (the hook can keep a stale height when the keyboard goes away without a normal animation, for example with the back button).
import { useEffect } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';
import { useAnimatedKeyboard, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

export default function useKeyboardLift() {
    const { height: windowHeight } = useWindowDimensions();
    const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true });
    const gone = useSharedValue(false);
    useAnimatedReaction(
        () => keyboard.height.value,
        (cur, prev) => { if (gone.value && prev !== null && cur !== prev) gone.value = false; },
    );
    useEffect(() => {
        const sub = Keyboard.addListener('keyboardDidHide', () => { gone.value = true; });
        return () => sub.remove();
    }, [gone]);
    return useAnimatedStyle(() => {
        const st = keyboard.state.value;
        const h = gone.value || !(st === 1 || st === 2 || st === 3) ? 0 : Math.min(keyboard.height.value, windowHeight * 0.6);
        return { paddingBottom: h };
    });
}
