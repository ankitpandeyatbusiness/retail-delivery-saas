// Opening a screen inside a tab, from anywhere, without stacking copies.
//
// In React Navigation 7 a plain navigate() PUSHES a new screen unless it is already the one on top. So navigate('Admin', ...) from a screen above
// the tabs (or from inside them) pushed a whole SECOND copy of the tabs on top, and a shop opened from Home, then another, piled up
// ShopDetail on ShopDetail. \`pop: true\` makes the navigator go back to the copy it already has and put the new params on it.
// withPop() sets it on every level of a nested { screen, params: { screen, params } } payload.
const withPop = (p) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...p };
    if (typeof p.screen === 'string') out.pop = true;
    if (p.params && typeof p.params === 'object' && typeof p.params.screen === 'string') out.params = withPop(p.params);
    return out;
};

// from a screen above the tabs (Search, Platform health, Inbox...) or from inside them: the one copy of the tabs, then the tab, then the screen
export const toAdmin = (nav, payload) => nav.navigate('Admin', withPop(payload), { pop: true });

// from inside the tabs: switch to a tab and open a screen in it, reusing the screen if that tab already shows it
export const goTab = (nav, tab, payload) => nav.navigate(tab, withPop(payload), { pop: true });
