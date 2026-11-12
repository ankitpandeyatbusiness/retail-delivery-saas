// The colours the superadmin can choose from for a shop's app: lots of solid colours in families, colours for each part (page, text, alert, accent), and ready-made
// GRADIENT COMBINATIONS. A combination is a light -> main -> dark run of colours (the app's headers and big buttons are drawn from the light colour to the dark one),
// plus an accent for the offer tags. Pick one and the rest of the colours (text, page, alert) are worked out to match (utils/palette.js).
// The colours here are starting points: utils/palette.js `fitCombo` darkens any colour a little when white text on it would be hard to read.

export const SWATCH_GROUPS = [
    { name: 'Reds', colors: ['#E23744', '#D32F2F', '#C62828', '#B71C1C', '#EF4444', '#F43F5E', '#E11D48', '#BE123C'] },
    { name: 'Oranges', colors: ['#F97316', '#EA580C', '#FB8C00', '#E65100', '#FF7043', '#FF6B3D', '#D9480F', '#C2410C'] },
    { name: 'Yellows and golds', colors: ['#F59E0B', '#D97706', '#CA8A04', '#B8860B', '#C9A227', '#D4A017', '#EAB308', '#A16207'] },
    { name: 'Greens', colors: ['#16A34A', '#15803D', '#22C55E', '#10B981', '#059669', '#65A30D', '#4D7C0F', '#2E7D32'] },
    { name: 'Teals and cyans', colors: ['#0D9488', '#0F766E', '#14B8A6', '#0891B2', '#0E7490', '#00897B', '#00838F', '#0E9F8E'] },
    { name: 'Blues', colors: ['#2563EB', '#1D4ED8', '#1E40AF', '#0284C7', '#0369A1', '#1565C0', '#2F80ED', '#0F4C81'] },
    { name: 'Purples and violets', colors: ['#7C3AED', '#6D28D9', '#5B21B6', '#9333EA', '#7E22CE', '#6A1B9A', '#4F46E5', '#4338CA'] },
    { name: 'Pinks and roses', colors: ['#DB2777', '#BE185D', '#D81B60', '#C2185B', '#AD1457', '#E0556F', '#D6336C', '#9D174D'] },
    { name: 'Browns and earth', colors: ['#92400E', '#78350F', '#7C2D12', '#8D6E63', '#6D4C41', '#5D4037', '#B45309', '#8B5A2B'] },
    { name: 'Deep and neutral', colors: ['#111827', '#1F2937', '#374151', '#475569', '#0F172A', '#18181B', '#27272A', '#1C1C1C'] },
];

export const ACCENT_GROUPS = [
    { name: 'Warm accents', colors: ['#F59E0B', '#FBBF24', '#FACC15', '#FB923C', '#F97316', '#FDE047'] },
    { name: 'Fresh accents', colors: ['#10B981', '#34D399', '#14B8A6', '#2DD4BF', '#84CC16', '#22C55E'] },
    { name: 'Cool accents', colors: ['#38BDF8', '#0EA5E9', '#60A5FA', '#818CF8', '#6366F1', '#22D3EE'] },
    { name: 'Bold accents', colors: ['#EC4899', '#F472B6', '#A855F7', '#E879F9', '#F43F5E', '#FB7185'] },
];

export const BG_GROUPS = [
    { name: 'Light pages', colors: ['#FFFFFF', '#FAFAFA', '#F8F5F0', '#FFF7ED', '#FEFCE8', '#F0FDF4', '#ECFEFF', '#EFF6FF', '#F5F3FF', '#FDF2F8', '#FFF1F2', '#F1F5F9'] },
    { name: 'Dark pages', colors: ['#0B0B0C', '#111111', '#121212', '#0F172A', '#0B1210', '#1A1210', '#14100E', '#10141A', '#160F1D', '#1C1917'] },
];

export const TEXT_GROUPS = [
    { name: 'Dark text', colors: ['#111111', '#1C1C1C', '#1F2937', '#0F172A', '#292524', '#3B2F2F', '#1E293B', '#1B1B1F'] },
    { name: 'Light text', colors: ['#FFFFFF', '#F8FAFC', '#F5F5F4', '#FEF3C7', '#E5E7EB'] },
];

export const ALERT_GROUPS = [
    { name: 'Alert reds', colors: ['#C62828', '#B91C1C', '#DC2626', '#E11D48', '#8F1D1D', '#D32F2F', '#F43F5E', '#9F1239'] },
    { name: 'Alert oranges', colors: ['#EA580C', '#D97706', '#F97316', '#C2410C'] },
];

// the tabs over the combinations
export const COMBO_TABS = ['All', 'Food and warm', 'Fresh', 'Cool', 'Bold duo', 'Elegant'];

// [name, group, light, main, dark, accent]
const RAW = [
    ['Chilli', 'Food and warm', '#FF6B6B', '#E23744', '#9B1B2A', '#F59E0B'],
    ['Sunset spice', 'Food and warm', '#FF9A3D', '#F4511E', '#A8231A', '#FFC107'],
    ['Saffron', 'Food and warm', '#FFB347', '#F57C00', '#B34700', '#14B8A6'],
    ['Mango', 'Food and warm', '#FFC94A', '#F59E0B', '#B45309', '#E23744'],
    ['Tandoor', 'Food and warm', '#FF8A5B', '#D9480F', '#7F2A06', '#FACC15'],
    ['Rose gold', 'Food and warm', '#F6A5B5', '#E0556F', '#8E2B45', '#F59E0B'],
    ['Berry blast', 'Food and warm', '#F472B6', '#C2185B', '#6A0F3A', '#FBBF24'],
    ['Cherry cola', 'Food and warm', '#E5484D', '#B3202A', '#5E0F17', '#F59E0B'],
    ['Lemonade', 'Food and warm', '#FACC15', '#F97316', '#C2410C', '#0EA5E9'],
    ['Citrus', 'Food and warm', '#FDE047', '#F59E0B', '#B45309', '#16A34A'],
    ['Lava', 'Food and warm', '#FB923C', '#DC2626', '#7F1D1D', '#FACC15'],
    ['Peach fizz', 'Food and warm', '#FB7185', '#F97316', '#C2410C', '#14B8A6'],
    ['Fresh mint', 'Fresh', '#34D399', '#059669', '#065F46', '#F59E0B'],
    ['Garden', 'Fresh', '#86EFAC', '#16A34A', '#14532D', '#F97316'],
    ['Lime zest', 'Fresh', '#BEF264', '#65A30D', '#365314', '#E23744'],
    ['Pistachio', 'Fresh', '#A3D977', '#4D8F2F', '#27501A', '#EC4899'],
    ['Spring', 'Fresh', '#5EEAD4', '#0D9488', '#115E59', '#F59E0B'],
    ['Forest', 'Fresh', '#4ADE80', '#15803D', '#052E16', '#F97316'],
    ['Jungle', 'Fresh', '#22C55E', '#0F766E', '#134E4A', '#FACC15'],
    ['Teal pop', 'Fresh', '#2DD4BF', '#0F766E', '#042F2E', '#F43F5E'],
    ['Ocean', 'Cool', '#38BDF8', '#0284C7', '#0C4A6E', '#F59E0B'],
    ['Deep sea', 'Cool', '#60A5FA', '#2563EB', '#1E3A8A', '#FB923C'],
    ['Lagoon', 'Cool', '#22D3EE', '#0891B2', '#164E63', '#F472B6'],
    ['Sky', 'Cool', '#7DD3FC', '#0EA5E9', '#075985', '#F59E0B'],
    ['Blueberry', 'Cool', '#6366F1', '#4338CA', '#1E1B4B', '#FB923C'],
    ['Indigo night', 'Cool', '#818CF8', '#4F46E5', '#1E1B4B', '#F472B6'],
    ['Royal', 'Bold duo', '#A78BFA', '#7C3AED', '#4C1D95', '#F59E0B'],
    ['Orchid', 'Bold duo', '#E879F9', '#A21CAF', '#581C87', '#FBBF24'],
    ['Plum', 'Bold duo', '#C084FC', '#7E22CE', '#3B0764', '#34D399'],
    ['Candy', 'Bold duo', '#F9A8D4', '#DB2777', '#831843', '#38BDF8'],
    ['Sunrise', 'Bold duo', '#FDBA74', '#F43F5E', '#9D174D', '#FACC15'],
    ['Tropical', 'Bold duo', '#2DD4BF', '#0284C7', '#6D28D9', '#F59E0B'],
    ['Aurora', 'Bold duo', '#34D399', '#0EA5E9', '#7C3AED', '#F59E0B'],
    ['Twilight', 'Bold duo', '#F472B6', '#8B5CF6', '#312E81', '#34D399'],
    ['Ember', 'Bold duo', '#F97316', '#BE123C', '#4C0519', '#FDE047'],
    ['Cocoa', 'Elegant', '#A1887F', '#6D4C41', '#3E2723', '#F59E0B'],
    ['Coffee', 'Elegant', '#C08B5C', '#8B5A2B', '#3F2A14', '#14B8A6'],
    ['Charcoal', 'Elegant', '#64748B', '#334155', '#0F172A', '#F59E0B'],
    ['Midnight gold', 'Elegant', '#475569', '#1E293B', '#020617', '#EAB308'],
    ['Wine', 'Elegant', '#BE185D', '#9F1239', '#4C0519', '#FBBF24'],
    ['Rosé', 'Elegant', '#FDA4AF', '#E11D48', '#881337', '#FDE68A'],
];

export const GRADIENT_COMBOS = RAW.map(([name, group, light, primary, dark, accent]) => ({ name, group, light, primary, dark, accent }));
