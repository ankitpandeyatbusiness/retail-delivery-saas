// After delivery: rate the delivery partner, and report a problem with the order.
//   DeliveryRatingCard  POST /orders/:id/delivery-rating   { rating 1-5, tags[], comment }   (once per order)
//   ComplaintCard       GET/POST /orders/:id/complaints     { type, text }                    (once, within 24 h of delivery)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, Pressable, TextInput, Modal, Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions,
} from 'react-native';
import PhotoViewer from './PhotoViewer';
import { ActivityIndicator } from './Loading';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useBrand } from './kit';
import { showToast, tint, useClosedStyle } from '../customers/shop';
import { rateDelivery, fetchComplaints, sendComplaint } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { pickPhoto, uploadComplaintPhoto, discardPhoto } from '../../utils/common/photoUpload';
import { ask } from './dialog';
import { tr } from '../../i18n';
import KeyboardScroll from './KeyboardScroll';
import { DragDown, Grip } from './DragDown';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const rs = (paise) => `₹${+(paise / 100).toFixed(2)}`;

function CardShell({ title, icon, children }) {
    const { primary, text, surface, border } = useBrand();
    return (
        <View style={[s.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={s.head}>
                <Ionicons name={icon} size={17} color={primary} />
                <Text style={[s.h, { color: text }]}>{title}</Text>
            </View>
            {children}
        </View>
    );
}

function Chip({ label, on, onPress }) {
    const { primary, text, border } = useBrand();
    return (
        <Pressable onPress={onPress} style={[s.chip, { borderColor: on ? primary : border, backgroundColor: on ? tint(primary) : 'transparent' }]}>
            <Text style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
        </Pressable>
    );
}

/* ------------------------------ delivery rating ------------------------------ */
const GOOD = ['On time', 'Polite', 'Careful handling', 'Followed instructions'];
const BAD = ['Late', 'Rude', 'Careless handling', 'Did not follow instructions'];
const WORDS = ['Very bad', 'Bad', 'Okay', 'Good', 'Excellent'];

// tracking = GET /orders/:id/tracking of a delivered order ({ canRate, deliveryRating, rider })
export function DeliveryRatingCard({ orderId, tracking, onDone, bare }) {   // bare: no card around it (inside a sheet)
    const { primary, text, muted, border, background, radius } = useBrand();
    const [rating, setRating] = useState(0);
    const [tags, setTags] = useState([]);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);

    const done = tracking?.deliveryRating;
    if (!tracking || (!tracking.canRate && !done)) return null;

    if (done) {
        return (
            <CardShell title={tr('Your delivery rating')} icon="bicycle-outline">
                <View style={s.stars}>
                    {[1, 2, 3, 4, 5].map((k) => (
                        <Ionicons key={k} name={done.rating >= k ? 'star' : 'star-outline'} size={26} color={done.rating >= k ? '#F5A623' : '#BBBBBB'} style={{ marginRight: 6 }} />
                    ))}
                </View>
                {done.tags?.length ? <View style={s.chips}>{done.tags.map((t) => <Chip key={t} label={t} on />)}</View> : null}
                {done.comment ? <Text style={[s.body, { color: text }]}>{done.comment}</Text> : null}
            </CardShell>
        );
    }

    const Wrap = bare ? ({ children }) => <View>{children}</View> : CardShell;
    const options = rating >= 4 ? GOOD : rating > 0 ? BAD : [];
    const pickRating = (k) => { setRating(k); setTags([]); };
    const toggle = (t) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 5 ? cur : [...cur, t]));

    const submit = async () => {
        if (!rating || busy) return;
        setBusy(true);
        try {
            await rateDelivery(orderId, { rating, ...(tags.length ? { tags } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
            showToast(tr('Thanks for rating your delivery'));
            onDone?.(rating);
        } catch (e) {
            showToast(errMsg(e));
            if (e?.response?.status === 409) onDone?.();   // already rated: reload and show it
        } finally { setBusy(false); }
    };

    return (
        <Wrap title={tracking.rider?.name ? tr('Rate {name}\'s delivery', { name: tracking.rider.name }) : tr('Rate the delivery')} icon="bicycle-outline">
            <View style={s.stars}>
                {[1, 2, 3, 4, 5].map((k) => (
                    <Pressable key={k} onPress={() => pickRating(k)} hitSlop={6}>
                        <Ionicons name={rating >= k ? 'star' : 'star-outline'} size={34} color={rating >= k ? '#F5A623' : '#BBBBBB'} style={{ marginRight: 10 }} />
                    </Pressable>
                ))}
            </View>
            <Text style={[s.word, { color: rating ? '#F5A623' : muted }]}>{rating ? WORDS[rating - 1] : tr('Tap a star to rate')}</Text>

            {options.length ? (
                <View style={s.chips}>
                    {options.map((t) => <Chip key={t} label={t} on={tags.includes(t)} onPress={() => toggle(t)} />)}
                </View>
            ) : null}

            {rating ? (
                <TextInput
                    value={comment} onChangeText={setComment} multiline maxLength={300}
                    placeholder={tr('Anything else? (optional)')} placeholderTextColor={muted}
                    style={[s.input, { color: text, borderColor: border, backgroundColor: background, minHeight: 64 }]}
                />
            ) : null}

            <Pressable
                disabled={!rating || busy} onPress={submit}
                style={[s.btn, { backgroundColor: primary, borderRadius: radius, opacity: rating ? 1 : 0.5 }]}
            >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text numberOfLines={1} style={s.btnTxt}>{tr('Submit rating')}</Text>}
            </Pressable>
        </Wrap>
    );
}

/* ------------------------------ complaint ------------------------------ */
const TYPES = [
    ['missing_item', 'Item missing'],
    ['wrong_item', 'Wrong item'],
    ['quality', 'Food quality'],
    ['late', 'Late delivery'],
    ['packaging', 'Packaging'],
    ['other', 'Something else'],
];
const TYPE_LABEL = { ...Object.fromEntries(TYPES), not_received: 'Order not received' };
const PHOTO_REQUIRED = ['wrong_item', 'quality'];   // a photo of the food must be attached for these (the server checks too)
const MAX_PHOTOS = 3;   // the server allows 3 photos per complaint
const STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

function resolutionLine(c) {
    if (c.status !== 'resolved') return '';
    if (c.resolution === 'no_refund') return 'No refund this time';
    if (c.resolution === 'refund_full' || c.resolution === 'refund_partial') {
        const amt = rs(c.refundPaise);
        if (c.refundStatus === 'done') return `${amt} refunded`;
        if (c.refundStatus === 'pending') return `${amt} refund is on its way`;
        if (c.refundStatus === 'failed') return `${amt} refund could not be sent. The shop will contact you`;
        return `The shop agreed to refund ${amt}`;
    }
    return '';
}

export function ComplaintCard({ orderId }) {
    const { primary, text, muted, border, background, surface, radius, error } = useBrand();
    const [data, setData] = useState(null);       // { items, canComplain, until }
    const closedStyle = useClosedStyle();   // the shop is closed: this popup turns grey
    const [open, setOpen] = useState(false);
    const [viewing, setViewing] = useState(null);   // a complaint photo open full screen
    const { height: winH } = useWindowDimensions();   // the sheet is as tall as its words, but never taller than the screen (it used to run off the top and look half open)
    // The dim background fades while only the sheet slides. (With the Modal's own "slide" the dim layer slid up too: a black block.)
    const [shown, setShown] = useState(false);
    const anim = useRef(new Animated.Value(0)).current;   // 0 = closed, 1 = open
    useEffect(() => {
        if (open) {
            setShown(true);
            const r = requestAnimationFrame(() => Animated.timing(anim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start());
            return () => cancelAnimationFrame(r);
        }
        Animated.timing(anim, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setShown(false));
        return undefined;
    }, [open, anim]);
    const [type, setType] = useState('');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [photos, setPhotos] = useState([]);   // [{ key, uri, status: 'uploading' | 'done', id, url }]

    const load = useCallback(async () => {
        try { setData(await fetchComplaints(orderId)); } catch (e) { /* the card just stays hidden */ }
    }, [orderId]);
    useEffect(() => { load(); }, [load]);
    // the shop answered or decided: the status and the reply show here at once
    useEffect(() => onNotification((n) => { if (n?.type === 'complaint_decision' && String(n.data?.orderId) === String(orderId)) load(); }), [orderId, load]);

    if (!data) return null;
    const c = data.items?.[0];

    const uploading = photos.some((p) => p.status === 'uploading');
    const needPhoto = PHOTO_REQUIRED.includes(type);

    const addPhoto = async (source) => {
        if (photos.length >= MAX_PHOTOS) return;
        let picked;
        try { picked = await pickPhoto(source); } catch (e) { showToast(e.safe ? e.message : tr('Could not open the camera or gallery')); return; }
        if (!picked) return;
        const key = `${Date.now()}-${Math.random()}`;
        setPhotos((cur) => [...cur, { key, uri: picked.uri, status: 'uploading' }]);
        try {
            const up = await uploadComplaintPhoto({ orderId, uri: picked.uri, mimeType: picked.mimeType });
            setPhotos((cur) => cur.map((p) => (p.key === key ? { ...p, status: 'done', id: up.id, url: up.url } : p)));
        } catch (e) {
            setPhotos((cur) => cur.filter((p) => p.key !== key));
            showToast(e.safe ? e.message : tr('Could not upload that photo'));
        }
    };

    const removePhoto = (p) => {
        setPhotos((cur) => cur.filter((x) => x.key !== p.key));
        discardPhoto(p.id);
    };

    // closing without sending: photos already stored for this order would count against the limit of 3, so remove them
    // "I did not get this order": one tap and one question, no form
    const notReceived = async () => {
        if (busy) return;
        const yes = await ask({ title: tr('You did not get this order?'), message: tr('The shop will check with the delivery partner and reply to you.'), confirmText: tr('Yes, I did not get it') });
        if (!yes) return;
        setBusy(true);
        try { await sendComplaint(orderId, { type: 'not_received' }); showToast(tr('Sent to the shop')); await load(); }
        catch (e) { showToast(errMsg(e)); if (e?.response?.status === 409) load(); }
        finally { setBusy(false); }
    };

    const closeSheet = () => {
        if (busy) return;
        photos.forEach((p) => discardPhoto(p.id));
        setPhotos([]);
        setOpen(false);
    };

    const submit = async () => {
        if (busy) return;
        if (!type) { showToast(tr('Choose what went wrong')); return; }
        if (body.trim().length < 3) { showToast(tr('Please describe the problem')); return; }
        if (uploading) { showToast(tr('Please wait, your photo is uploading')); return; }
        if (needPhoto && !photos.some((p) => p.status === 'done')) { showToast(tr('Please add a photo of the food')); return; }
        setBusy(true);
        try {
            const urls = photos.filter((p) => p.status === 'done').map((p) => p.url);
            await sendComplaint(orderId, { type, text: body.trim(), ...(urls.length ? { photos: urls } : {}) });
            showToast(tr('Complaint sent to the shop'));
            setOpen(false); setType(''); setBody(''); setPhotos([]);
            await load();
        } catch (e) {
            showToast(errMsg(e));
            if (e?.response?.status === 409) { setOpen(false); load(); }
        } finally { setBusy(false); }
    };

    if (c) {
        const line = resolutionLine(c);
        return (
            <CardShell title={tr('Your complaint')} icon="alert-circle-outline">
                <View style={s.rowBetween}>
                    <Text style={[s.strong, { color: text }]}>{TYPE_LABEL[c.type] || tr('Problem')}</Text>
                    <View style={[s.pill, { backgroundColor: tint(c.status === 'resolved' ? '#1E8E3E' : primary) }]}>
                        <Text style={[s.pillTxt, { color: c.status === 'resolved' ? '#1E8E3E' : primary }]}>{STATUS[c.status] || c.status}</Text>
                    </View>
                </View>
                <Text style={[s.body, { color: muted }]}>{c.text}</Text>
                {c.photos?.length ? (
                    <View style={s.thumbs}>
                        {c.photos.map((u) => <Pressable key={u} onPress={() => setViewing(u)}><Image source={{ uri: u }} style={[s.thumb, { borderColor: border }]} contentFit="cover" /></Pressable>)}
                    </View>
                ) : null}
                <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
                {c.ownerReply ? (
                    <View style={[s.reply, { backgroundColor: tint(primary) }]}>
                        <Text style={[s.replyLabel, { color: muted }]}>{tr('Reply from the shop')}</Text>
                        <Text style={[s.body, { color: text, marginTop: 2 }]}>{c.ownerReply}</Text>
                    </View>
                ) : null}
                {line ? <Text style={[s.strong, { color: c.resolution === 'no_refund' ? muted : '#1E8E3E', marginTop: 10 }]}>{line}</Text> : null}
            </CardShell>
        );
    }

    if (!data.canComplain) return null;   // the 24 hour window is over

    return (
        <>
            <CardShell title={tr('Something wrong with this order?')} icon="alert-circle-outline">
                <Text style={[s.body, { color: muted }]}>{tr('Tell the shop what went wrong{v1}.', { v1: data.until ? ` (until ${new Date(data.until).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })})` : '' })}</Text>
                <Pressable onPress={notReceived} disabled={busy} style={[s.ghost, { borderColor: error, borderRadius: radius, marginBottom: 8, opacity: busy ? 0.6 : 1 }]}>
                    <Text style={[s.ghostTxt, { color: error }]}>{tr('I did not get this order')}</Text>
                </Pressable>
                <Pressable onPress={() => setOpen(true)} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                    <Text style={[s.ghostTxt, { color: primary }]}>{tr('Report a problem')}</Text>
                </Pressable>
            </CardShell>

            <Modal visible={shown} transparent animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.modalWrap, closedStyle]}>
                    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)', opacity: anim }]} />
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
                    <DragDown visible={open} onClose={closeSheet}>{(scroll) => (
                    <Animated.View style={[s.sheet, { backgroundColor: surface, maxHeight: Math.round(winH * 0.88), transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [640, 0] }) }] }]}>
                        <Grip><View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 12 }} /></Grip>
                        <KeyboardScroll {...scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                            <Text style={[s.sheetTitle, { color: text }]}>{tr('Report a problem')}</Text>
                            <Text style={[s.label, { color: muted }]}>{tr('WHAT WENT WRONG?')}</Text>
                            <View style={s.chips}>
                                {TYPES.map(([k, label]) => <Chip key={k} label={label} on={type === k} onPress={() => setType(k)} />)}
                            </View>
                            <Text style={[s.label, { color: muted }]}>{tr('TELL US MORE')}</Text>
                            <TextInput
                                value={body} onChangeText={setBody} multiline maxLength={500}
                                placeholder={tr('What happened?')} placeholderTextColor={muted}
                                style={[s.input, { color: text, borderColor: border, backgroundColor: background, minHeight: 100 }]}
                            />
                            <Text style={[s.count, { color: body.length >= 500 ? error : muted }]}>{body.length}/500</Text>

                            <Text style={[s.label, { color: needPhoto && !photos.length ? error : muted }]}>
                                {needPhoto ? tr('PHOTO OF THE FOOD (REQUIRED, UP TO {MAX_PHOTOS})', { MAX_PHOTOS: MAX_PHOTOS }) : tr('PHOTOS (OPTIONAL, UP TO {MAX_PHOTOS})', { MAX_PHOTOS: MAX_PHOTOS })}
                            </Text>
                            <View style={s.thumbs}>
                                {photos.map((p) => (
                                    <View key={p.key} style={[s.thumb, { borderColor: border }]}>
                                        <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                        {p.status === 'uploading' ? (
                                            <View style={s.thumbBusy}><ActivityIndicator color="#FFFFFF" /></View>
                                        ) : (
                                            <Pressable onPress={() => removePhoto(p)} hitSlop={6} style={s.thumbX}>
                                                <Ionicons name="close" size={14} color="#FFFFFF" />
                                            </Pressable>
                                        )}
                                    </View>
                                ))}
                                {photos.length < MAX_PHOTOS ? (
                                    <>
                                        <Pressable onPress={() => addPhoto('camera')} style={[s.thumb, s.add, { borderColor: primary }]}>
                                            <Ionicons name="camera-outline" size={22} color={primary} />
                                            <Text style={[s.addTxt, { color: primary }]}>{tr('Camera')}</Text>
                                        </Pressable>
                                        <Pressable onPress={() => addPhoto('gallery')} style={[s.thumb, s.add, { borderColor: primary }]}>
                                            <Ionicons name="images-outline" size={22} color={primary} />
                                            <Text style={[s.addTxt, { color: primary }]}>{tr('Gallery')}</Text>
                                        </Pressable>
                                    </>
                                ) : null}
                            </View>

                            <View style={s.rowBtns}>
                                <Pressable disabled={busy} onPress={closeSheet} style={[s.ghost, { flex: 1, marginRight: 10, borderColor: border, borderRadius: radius }]}>
                                    <Text style={[s.ghostTxt, { color: text }]}>{tr('Cancel')}</Text>
                                </Pressable>
                                <Pressable disabled={busy || uploading} onPress={submit} style={[s.btn, { flex: 1.4, marginTop: 0, backgroundColor: primary, borderRadius: radius, opacity: uploading ? 0.6 : 1 }]}>
                                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text numberOfLines={1} style={s.btnTxt}>{tr('Send')}</Text>}
                                </Pressable>
                            </View>
                        </KeyboardScroll>
                    </Animated.View>
                    )}</DragDown>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

const s = StyleSheet.create({
    card: { marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 16 },
    head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    h: { fontSize: 15, fontWeight: '800', marginLeft: 8 },
    stars: { flexDirection: 'row', marginTop: 2 },
    word: { fontSize: 13, fontWeight: '700', marginTop: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
    chip: { borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, marginBottom: 8 },
    chipTxt: { fontSize: 13, fontWeight: '700' },
    input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, textAlignVertical: 'top', marginTop: 10 },
    count: { alignSelf: 'flex-end', fontSize: 11.5, fontWeight: '600', marginTop: 4 },
    btn: { marginTop: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
    btnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    ghost: { marginTop: 12, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    ghostTxt: { fontSize: 14, fontWeight: '800' },
    body: { fontSize: 13.5, fontWeight: '500', lineHeight: 19, marginTop: 6 },
    strong: { fontSize: 14, fontWeight: '800' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    pillTxt: { fontSize: 12, fontWeight: '800' },
    reply: { marginTop: 12, borderRadius: 12, padding: 12 },
    replyLabel: { fontSize: 11.5, fontWeight: '700' },
    modalWrap: { flex: 1, justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 26 },
    sheetTitle: { fontSize: 18, fontWeight: '900', marginBottom: 14 },
    label: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1, marginTop: 8 },
    rowBtns: { flexDirection: 'row', marginTop: 14 },
    thumbs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
    thumb: { width: 76, height: 76, borderRadius: 12, borderWidth: 1, marginRight: 10, marginBottom: 10, overflow: 'hidden' },
    thumbBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    thumbX: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
    add: { borderStyle: 'dashed', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    addTxt: { fontSize: 11, fontWeight: '800', marginTop: 2 },
});
