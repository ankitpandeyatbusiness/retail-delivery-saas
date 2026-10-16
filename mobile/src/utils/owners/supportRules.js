// Labels for the help and support screens.
export const SUPPORT_TOPICS = [
    ['billing', 'Bill or payment'],
    ['orders', 'Menu or orders'],
    ['app', 'App problem'],
    ['account', 'My phone or shop details'],
    ['other', 'Something else'],
];

// status -> words and colour
export const SUPPORT_STATUS = {
    open: { label: 'Waiting for us', color: (primary, error) => error },
    answered: { label: 'We replied', color: (primary) => primary },
    resolved: { label: 'Solved', color: () => '#16A34A' },
};

export const MAX_PICTURES = 3;
