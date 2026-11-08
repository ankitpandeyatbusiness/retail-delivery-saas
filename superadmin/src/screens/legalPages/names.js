// Short names for the documents, so a row never has to wrap.
export const DOC_NAME = {
    customer_terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    owner_terms: 'Terms for shop owners',
    owner_privacy: 'Privacy Policy for shop owners',
    rider_terms: 'Terms for riders',
    rider_privacy: 'Privacy Policy for riders',
    staff_terms: 'Terms for kitchen and waiters',
    staff_privacy: 'Privacy Policy for kitchen and waiters',
    about_us: 'About Us (web page)',
};
export const GROUPS = [
    ['Customers', ['customer_terms', 'privacy'], 'catalog'],
    ['Shop owners', ['owner_terms', 'owner_privacy'], 'people'],
    ['Riders, kitchen staff and waiters', ['rider_terms', 'rider_privacy', 'staff_terms', 'staff_privacy'], 'riders'],
    ['About Us on the website', ['about_us'], 'platform'],
];
