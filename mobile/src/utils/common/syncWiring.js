// Which data a change on another device refreshes (web phase 12). Started once, from utils/common/push.js. Screens that load on focus need nothing here:
// they load again by themselves (hooks/common/useLiveFocus.js). This is for the data that is kept in a store and loaded once, not by a screen.
import { useAuthStore } from '../../store/common/useAuthStore';
import { useMeStore } from '../../store/customers/useMeStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { useFavStore, useCartStore } from '../../store/customers/shopStores';
import { useAlertPrefs } from '../../store/common/useAlertPrefs';
import { startSync, onSyncArea } from './syncEvents';

let wired = false;
export function wireSync() {
    if (wired) return;
    wired = true;
    startSync();

    const signedIn = () => !!useAuthStore.getState().user;
    onSyncArea('me', () => { if (signedIn()) useMeStore.getState().refresh(); });                // name, picture, email, language
    onSyncArea('addresses', () => { if (signedIn()) useAddressStore.getState().refresh(); });    // saved addresses
    onSyncArea('favourites', () => { if (signedIn()) useFavStore.getState().load(); });
    onSyncArea('me/alerts', () => { if (signedIn()) useAlertPrefs.getState().load(); });         // the Alerts screen's switches
    onSyncArea('cart', () => { if (signedIn()) useCartStore.getState().pull(); });               // the cart (a customer's)

    // the cart is shared once a customer is known: at start and right after a login
    let wasIn = false;
    const onUser = () => {
        const now = signedIn();
        if (now && !wasIn) useCartStore.getState().syncOnLogin();
        wasIn = now;
    };
    useAuthStore.subscribe(onUser);
    onUser();
}
