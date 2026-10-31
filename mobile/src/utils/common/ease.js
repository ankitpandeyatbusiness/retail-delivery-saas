// A smooth change of layout: call ease() just before the state change that opens, closes, adds or removes something, and the screen glides
// to its new shape instead of jumping (an accordion, a filter that changes a list, a row that appears).
import { LayoutAnimation, Platform, UIManager } from 'react-native';

// the old Android renderer needs this switched on once; the new one animates by itself
if (Platform.OS === 'android' && !global.nativeFabricUIManager && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

export const ease = () => LayoutAnimation.configureNext(LayoutAnimation.create(230, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
