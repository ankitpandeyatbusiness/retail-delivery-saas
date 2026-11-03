import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSlug, isHomeBranch } from './branch';

// the build's own shop keeps the old name; another branch gets its own set, so a menu or cart never shows in the wrong branch
const prefix = () => (isHomeBranch() ? 'cache:' : `cache.${getSlug()}:`);

export async function readCache(key) {
    try {
        const text = await AsyncStorage.getItem(prefix() + key);
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export function writeCache(key, value) {
    AsyncStorage.setItem(prefix() + key, JSON.stringify(value)).catch(() => { });
}