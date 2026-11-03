// Opening a screen inside a tab, from anywhere: without stacking copies, and with Back returning to where you came from.
//
// 1. No piling up. In React Navigation 7 a plain navigate() PUSHES a new screen unless it is already the one on top. So navigate('Admin', ...) from a screen
//    above the tabs (or from inside them) pushed a whole SECOND copy of the tabs, and a shop opened from Home, then another, piled up ShopDetail on
//    ShopDetail. \`pop: true\` makes the navigator go back to the copy it already has and put the new params on it (withPop sets it on every level).
//
// 2. Back goes home. A screen opened from another place remembers that place in its params as \`returnTo\`:
//      { tab, screen?, params? }               a screen of a tab (Home, or Orders > Order detail ...)
//      { root, params?, underTab }             a screen above the tabs (Search, Platform health, Inbox...) and the tab that was under it
//    The Back button and the phone's Back key (components/layout.jsx) call backTo(), which goes to that place instead of to the first screen of the
//    tab the new screen happens to live in. Opened from its own tab, nothing is stored and Back is the normal Back.

import { CommonActions } from '@react-navigation/native';

// the first screen of each tab's stack: a tab named on its own is opened at this screen, so it can carry its way back
const TAB_ROOT = { ShopsTab: 'ShopsList', OrdersTab: 'OrdersHome', MoneyTab: 'MoneyHome', MoreTab: 'MoreHome' };

const withPop = (p) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    if (typeof p.screen === 'string') out.pop = true;
    if (p.params && typeof p.params === 'object' && typeof p.params.screen === 'string') out.params = withPop(p.params);
    return out;
};

// where we are now, from the navigation object of the screen that is opening the other one
function originOf(nav) {
    try {
        const st = nav.getState();
        const r = st.routes[st.index];
        if (st.type === 'tab') return { tab: r.name };                                      // a tab's own screen, like Home
        const { returnTo, ...params } = r.params || {};                                      // (what it was opened with, but not its own way back)
        const parent = nav.getParent?.();
        const ps = parent?.getState?.();
        if (ps && ps.type === 'tab') return { tab: ps.routes[ps.index].name, screen: r.name, params };
        const admin = st.routes.find((x) => x.name === 'Admin');                             // above the tabs: remember the tab under it
        const ts = admin?.state;
        return { root: r.name, params, underTab: ts ? ts.routes[ts.index].name : 'HomeTab' };
    } catch (e) { return null; }
}

// put returnTo into the params of the screen that is finally opened (the deepest { screen, params })
const leafReturn = (p, o, atTab) => {
    if (!p || typeof p.screen !== 'string') return p;
    if (p.params && typeof p.params === 'object' && typeof p.params.screen === 'string') return { ...p, params: leafReturn(p.params, o, false) };
    if (atTab) return p;                                                                      // only a tab named: its first screen has no Back
    return { ...p, params: { ...(p.params || {}), returnTo: o } };
};
const sameTab = (o, tab) => !!o && o.tab === tab;

// from a screen above the tabs (Search, Platform health, Inbox...) or from inside them: the one copy of the tabs, then the tab, then the screen
export const toAdmin = (nav, payload) => {
    const o = originOf(nav);
    const bare = payload && TAB_ROOT[payload.screen] && !payload.params ? { screen: payload.screen, params: { screen: TAB_ROOT[payload.screen] } } : payload;
    const p = o && !sameTab(o, bare?.screen) ? leafReturn(bare, o, true) : bare;
    return nav.navigate('Admin', withPop(p), { pop: true });
};

// from inside the tabs: switch to a tab and open a screen in it, reusing the screen if that tab already shows it
export const goTab = (nav, tab, payload) => {
    const o = originOf(nav);
    const p = o && !sameTab(o, tab) ? leafReturn(payload, o, false) : payload;
    return nav.navigate(tab, withPop(p), { pop: true });
};

// Back, for a screen that has a returnTo: go to that place
export function backTo(nav, o) {
    if (!o) { nav.goBack(); return; }
    if (o.tab) {
        nav.navigate(o.tab, o.screen ? withPop({ screen: o.screen, params: o.params }) : undefined, { pop: true });
        return;
    }
    if (o.root) {
        // [the tabs, with the tab that was under it showing] + [the screen above the tabs again], in ONE change: no flash of the tab in between
        let top = nav;
        while (top.getParent?.()) top = top.getParent();
        const st = top.getState();
        const admin = st.routes.find((x) => x.name === 'Admin');
        const ts = admin?.state;
        const at = ts ? ts.routes.findIndex((x) => x.name === (o.underTab || 'HomeTab')) : -1;
        if (!admin || at < 0) { nav.navigate(o.root, o.params); return; }
        top.dispatch(CommonActions.reset({ index: 1, routes: [{ key: admin.key, name: 'Admin', state: { ...ts, index: at } }, { name: o.root, params: { ...(o.params || {}), noAnim: true } }] }));
        return;
    }
    nav.goBack();
}
