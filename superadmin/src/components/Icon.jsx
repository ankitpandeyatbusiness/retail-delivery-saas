import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

// Phosphor icons, two-tone ("duotone"). Each one is imported by its own path so only the icons used are bundled.
import { House } from 'phosphor-react-native/src/icons/House';
import { Storefront } from 'phosphor-react-native/src/icons/Storefront';
import { List } from 'phosphor-react-native/src/icons/List';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { XCircle } from 'phosphor-react-native/src/icons/XCircle';
import { CaretLeft } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRight } from 'phosphor-react-native/src/icons/CaretRight';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { PlusCircle } from 'phosphor-react-native/src/icons/PlusCircle';
import { WarningCircle } from 'phosphor-react-native/src/icons/WarningCircle';
import { Receipt } from 'phosphor-react-native/src/icons/Receipt';
import { CurrencyInr } from 'phosphor-react-native/src/icons/CurrencyInr';
import { Bell } from 'phosphor-react-native/src/icons/Bell';
import { Pulse } from 'phosphor-react-native/src/icons/Pulse';
import { Key } from 'phosphor-react-native/src/icons/Key';
import { Users } from 'phosphor-react-native/src/icons/Users';
import { User } from 'phosphor-react-native/src/icons/User';
import { PencilSimple } from 'phosphor-react-native/src/icons/PencilSimple';
import { ShieldCheck } from 'phosphor-react-native/src/icons/ShieldCheck';
import { ChatCircleDots } from 'phosphor-react-native/src/icons/ChatCircleDots';
import { Fire } from 'phosphor-react-native/src/icons/Fire';
import { Bicycle } from 'phosphor-react-native/src/icons/Bicycle';
import { Eye } from 'phosphor-react-native/src/icons/Eye';
import { Phone } from 'phosphor-react-native/src/icons/Phone';
import { Prohibit } from 'phosphor-react-native/src/icons/Prohibit';
import { CheckCircle } from 'phosphor-react-native/src/icons/CheckCircle';
import { UserPlus } from 'phosphor-react-native/src/icons/UserPlus';
import { PaperPlaneTilt } from 'phosphor-react-native/src/icons/PaperPlaneTilt';
import { SignOut } from 'phosphor-react-native/src/icons/SignOut';
import { Tray } from 'phosphor-react-native/src/icons/Tray';
import { CloudSlash } from 'phosphor-react-native/src/icons/CloudSlash';
import { ShoppingBag } from 'phosphor-react-native/src/icons/ShoppingBag';
import { Wallet } from 'phosphor-react-native/src/icons/Wallet';
import { Gear } from 'phosphor-react-native/src/icons/Gear';
import { Tag } from 'phosphor-react-native/src/icons/Tag';
import { Image } from 'phosphor-react-native/src/icons/Image';
import { ForkKnife } from 'phosphor-react-native/src/icons/ForkKnife';
import { Sliders } from 'phosphor-react-native/src/icons/Sliders';
import { Clock } from 'phosphor-react-native/src/icons/Clock';
import { Megaphone } from 'phosphor-react-native/src/icons/Megaphone';
import { ChartLineUp } from 'phosphor-react-native/src/icons/ChartLineUp';
import { Palette } from 'phosphor-react-native/src/icons/Palette';
import { Lock } from 'phosphor-react-native/src/icons/Lock';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { Wrench } from 'phosphor-react-native/src/icons/Wrench';
import { Bank } from 'phosphor-react-native/src/icons/Bank';
import { ClipboardText } from 'phosphor-react-native/src/icons/ClipboardText';
import { Package } from 'phosphor-react-native/src/icons/Package';
import { Crown } from 'phosphor-react-native/src/icons/Crown';
import { Sparkle } from 'phosphor-react-native/src/icons/Sparkle';
import { Check } from 'phosphor-react-native/src/icons/Check';
import { Trash } from 'phosphor-react-native/src/icons/Trash';
import { Copy } from 'phosphor-react-native/src/icons/Copy';
import { MapPin } from 'phosphor-react-native/src/icons/MapPin';
import { Percent } from 'phosphor-react-native/src/icons/Percent';
import { Lightning } from 'phosphor-react-native/src/icons/Lightning';
import { Broadcast } from 'phosphor-react-native/src/icons/Broadcast';
import { Info } from 'phosphor-react-native/src/icons/Info';

// Ask for icons by MEANING. To change an icon app-wide, change it here, once.
const MAP = {
    home: House, shops: Storefront, menu: List, search: MagnifyingGlass, clear: XCircle,
    back: CaretLeft, next: CaretRight, add: Plus, addCircle: PlusCircle, warning: WarningCircle,
    receipt: Receipt, rupee: CurrencyInr, bell: Bell, live: Pulse, key: Key, users: Users, user: User,
    edit: PencilSimple, shield: ShieldCheck, message: ChatCircleDots, fire: Fire, rider: Bicycle,
    eye: Eye, phone: Phone, block: Prohibit, ok: CheckCircle, userAdd: UserPlus, send: PaperPlaneTilt,
    logout: SignOut, empty: Tray, offline: CloudSlash, orders: ShoppingBag, wallet: Wallet, settings: Gear,
    coupon: Tag, banner: Image, food: ForkKnife, tune: Sliders, clock: Clock, megaphone: Megaphone,
    chart: ChartLineUp, palette: Palette, lock: Lock, star: Star, tool: Wrench, bank: Bank,
    notes: ClipboardText, box: Package, crown: Crown, sparkle: Sparkle, check: Check, trash: Trash,
    copy: Copy, pin: MapPin, percent: Percent, bolt: Lightning, broadcast: Broadcast, info: Info,
};

// Names the first screens were written with (Ionicons) -> the meaning above. Screens are moved to the new
// names as they are re-skinned; until then these keep working.
const ALIAS = {
    'home-outline': 'home', home: 'home', 'storefront-outline': 'shops', storefront: 'shops',
    'menu-outline': 'menu', search: 'search', 'close-circle': 'clear', 'chevron-back': 'back',
    'chevron-forward': 'next', add: 'add', 'add-circle-outline': 'addCircle', 'alert-circle-outline': 'warning',
    'receipt-outline': 'receipt', receipt: 'receipt', 'cash-outline': 'rupee', notifications: 'bell',
    pulse: 'live', 'pulse-outline': 'live', 'key-outline': 'key', 'people-outline': 'users',
    'create-outline': 'edit', 'shield-checkmark-outline': 'shield', 'chatbubble-ellipses-outline': 'message',
    'chatbox-ellipses-outline': 'message', 'flame-outline': 'fire', 'bicycle-outline': 'rider',
    'eye-outline': 'eye', 'call-outline': 'phone', 'ban-outline': 'block', 'checkmark-circle-outline': 'ok',
    'person-add-outline': 'userAdd', send: 'send', 'log-out-outline': 'logout', 'file-tray-outline': 'empty',
    'cloud-offline-outline': 'offline',
};

/*
 * <Icon name="orders" size={22} color={...} filled />
 * duotone by default; `filled` makes it solid (use for the active tab).
 */
export default function Icon({ name, size = 22, color, filled, style }) {
    const t = useTheme();
    const key = MAP[name] ? name : ALIAS[name];
    const Cmp = key ? MAP[key] : null;
    const c = color || t.text;
    if (Cmp) return <Cmp size={size} color={c} weight={filled ? 'fill' : 'duotone'} style={style} />;
    return <Ionicons name={name} size={size} color={c} style={style} />;   // anything not mapped yet
}
