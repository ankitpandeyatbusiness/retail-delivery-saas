// Switch the app to another branch of the brand.
//   an owner (brand owner)  -> POST /brand/switch
//   a customer              -> POST /customer-branch/session
// The server answers with that branch's own login. It is saved under the branch's name, the branch becomes the active one,
// and the app restarts so every screen, list and saved cart starts clean (nothing of the old branch can show in the new one).
import { DevSettings } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import api from '../../api/common/client';
import { useAuthStore } from '../../store/common/useAuthStore';
import { getSlug, keyFor, rememberBranch, setActive } from './branch';

export async function reloadApp() {
    try { await Updates.reloadAsync(); } catch (e) {
        try { DevSettings.reload(); } catch (e2) { /* a development build without reload: restart the app by hand */ }
    }
}

export async function switchBranch(slug) {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('Sign in first');
    if (slug === getSlug()) return;
    const path = user.role === 'admin' ? '/brand/switch' : user.role === 'customer' ? '/customer-branch/session' : null;
    if (!path) throw new Error('This account cannot switch branches');

    const { data } = await api.post(path, { slug });
    if (!data || !data.accessToken || !data.refreshToken || !data.slug) throw new Error('Could not switch branch');
    await SecureStore.setItemAsync(keyFor('refreshToken', data.slug), data.refreshToken);
    await SecureStore.setItemAsync(keyFor('user', data.slug), JSON.stringify(data.user || { ...user }));
    await rememberBranch(data.slug);
    await setActive(data.slug);
    await reloadApp();
}
