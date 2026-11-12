// The demo panel switcher (private demo login). Asks the server for the other panel's login, saves it under that shop's name,
// makes that shop the active one and restarts the app: the same steps as switching branch (utils/common/switchBranch.js).
// Owner, Cook, Waiter and Rider open in the demo shop (pretend people); Customer returns to the shop where the demo started.
import * as SecureStore from 'expo-secure-store';
import api from '../../api/common/client';
import { keyFor, rememberBranch, setActive, getSlug } from './branch';
import { reloadApp } from './switchBranch';

export async function fetchDemoPanels() {
    const { data } = await api.get('/demo/panels');
    return data;   // { current, panels: [{ key, label, available }] }
}

export async function switchDemoPanel(panel) {
    const { data } = await api.post('/demo/switch', { panel });
    if (!data || !data.accessToken || !data.refreshToken || !data.slug) throw new Error('Could not open that panel');
    await SecureStore.setItemAsync(keyFor('refreshToken', data.slug), data.refreshToken);
    await SecureStore.setItemAsync(keyFor('user', data.slug), JSON.stringify(data.user));
    await rememberBranch(data.slug);
    await setActive(data.slug);
    await reloadApp();
    return getSlug();
}
