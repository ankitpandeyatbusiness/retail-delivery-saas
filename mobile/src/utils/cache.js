import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'cache:';

export async function readCache(key) {
    try {
        const text = await AsyncStorage.getItem(PREFIX + key);
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
}

export function writeCache(key, value) {
    AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => { });
}