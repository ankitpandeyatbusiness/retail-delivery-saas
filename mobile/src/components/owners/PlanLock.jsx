// Shows owners what a higher plan would give, quietly: a small GROWTH / PRO tag, and a note that opens the Plan screen only when tapped.
// Nothing here pops up by itself, and an owner whose plan already has the feature sees none of it.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

// "Growth" / "Pro" tag (plan names are not translated)
export function PlanTag({ need }) {
    const { primary } = useBrand();
    return (
        <View style={{ backgroundColor: primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>{String(need || 'Pro').toUpperCase()}</Text>
        </View>
    );
}

// what each locked feature does and who it is for, in a few plain words (shown before the owner decides to upgrade)
const INFO = {
    dineIn: () => tr('Guests scan a QR code at the table and order from their own phone, and the bill is kept per table. Use it if you serve people at tables and want fewer staff taking orders.'),
    customPush: () => tr('Sends reminders and offers to your customers by itself, for example to those who have not ordered for a while. Use it to bring customers back without messaging anyone by hand.'),
    loyalty: () => tr('Customers earn points on every order and spend them on their next one. Use it to make regular customers come back more often.'),
    costsProfit: () => tr('Add what you spend, such as ingredients, salaries and rent, and see what the shop really kept after costs. Use it to know whether you are making money, not just sales.'),
    analytics: () => tr('Progress charts, your most popular items and tips, with PDF reports you can save or share. Use it to see what sells, when you are busiest and how you are growing.'),
    staffLogins: () => tr('Give your cooks and waiters their own login and screen. Cooks see the orders to prepare and waiters see the tables. Use it so your team works from their own phones and you can see what each one handled.'),
    services: () => tr('Sell things that are not on your menu, such as tiffin plans, catering or party bookings, and take inquiries from customers. Use it when customers ask for something made to order.'),
    bulkOrders: () => tr('Take large orders from offices, parties and functions with quotes and bulk prices. Use it when customers order big quantities in advance.'),
    multiBranch: () => tr('Run several shops from one account: switch between them, see all branches together and share your menu. Use it if you have more than one outlet.'),
    fullExports: () => tr('Full Excel or CSV files with customer names, phones and addresses, orders, items and reports. Use it for your accounts, your marketing or to keep your own records.'),
    soundboxVoice: () => tr('Your phone speaks every new order aloud, even when you are busy. Use it so you never miss an order in a noisy kitchen.'),
    riderLiveMap: () => tr('Customers watch the rider move on a map until the order arrives. Use it to cut the calls asking where the order is.'),
};
export const infoOf = (feature) => (INFO[feature] ? INFO[feature]() : '');

// the plan an owner needs for a feature, or null when his plan has it (or he has no plan yet: nothing is locked)
export const useNeeds = (feature) => {
    const plan = useMenuFlags((s) => s.plan);
    return plan && plan.features?.[feature] === false ? (plan.needs?.[feature] || 'Pro') : null;
};

// a tap on a locked thing: say what it is and offer the Plan screen
export async function askUpgrade(nav, { title, message, need, feature }, go) {
    const yes = await ask({
        title, icon: 'lock-closed', confirmText: tr('See plans'), cancelText: tr('Not now'),
        message: `${(feature && infoOf(feature)) || message ? `${(feature && infoOf(feature)) || message}\n\n` : ''}${tr('Available in {plan}. Upgrade your plan to use it.', { plan: need })}`,
    });
    if (yes) (go || ((r) => nav.navigate(r)))('OwnerPlan');
}

// a small card where a hidden option would be: the tag, one benefit line, "See plans"
export function UpgradeNote({ feature, text, style }) {
    const need = useNeeds(feature);
    const nav = useNavigation();
    const { primary, text: ink, muted } = useBrand();
    if (!need) return null;
    return (
        <Pressable onPress={() => askUpgrade(nav, { title: text, need, feature })} style={[{ flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.08) }, style]}>
            <Ionicons name="lock-closed" size={18} color={primary} />
            <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Text style={{ color: ink, fontSize: 13, fontWeight: '700' }}>{text}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Available in {plan}', { plan: need })}</Text>
            </View>
            <PlanTag need={need} />
        </Pressable>
    );
}
