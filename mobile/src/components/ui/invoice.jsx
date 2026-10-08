// src/components/ui/invoice.js
import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import ReactNativeBlobUtil from 'react-native-blob-util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../api/client';
import { showToast } from './shop';
import { ask } from './dialog';

const KEY = 'invoice.saveDir';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nameOf = (o) => `invoice-${o.orderNo}.pdf`;
const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

// Restaurant / Invoices / Oct-2026   (restaurant name comes from the order itself)
const pathOf = (o) => {
    const d = new Date(o.createdAt);
    const parts = [clean(o.seller?.name), 'Invoices', `${MON[d.getMonth()]}-${d.getFullYear()}`].filter(Boolean);
    return parts;
};

async function fetchPdf(order) {
    const res = await api.get(`/orders/${order.id}/invoice`, { responseType: 'arraybuffer' });
    const bytes = new Uint8Array(res.data);
    const file = new File(Paths.cache, nameOf(order));
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return { file, bytes };
}

const fail = (e) => showToast(e?.response?.status === 409 ? 'The invoice is only available after delivery' : 'Could not get the invoice');

async function share(file, order) {
    if (!(await Sharing.isAvailableAsync())) { showToast('Sharing is not available on this device'); return; }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: nameOf(order), UTI: 'com.adobe.pdf' });
}

// Tap on an invoice: opens the PDF in the phone's PDF viewer.
export async function viewInvoice(order, setBusy) {
    if (setBusy) setBusy(true);
    try {
        const { file } = await fetchPdf(order);
        if (Platform.OS === 'android') {
            try {
                await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: 'application/pdf', flags: 1 });
            } catch (e) { await share(file, order); }
        } else {
            await share(file, order);
        }
    } catch (e) { fail(e); } finally { if (setBusy) setBusy(false); }
}

// Fallback only: one-time folder pick, then our own sub-folders inside it.
async function pickBase() {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) { try { return new Directory(saved); } catch (e) { /* ask again */ } }
    const ok = await ask({ title: 'Choose a folder', message: 'Pick where invoices should be saved, for example Documents. You only do this once.', confirmText: 'Choose', icon: 'folder-open-outline' });
    if (!ok) throw Object.assign(new Error('cancelled'), { cancelled: true });
    const d = await Directory.pickDirectoryAsync();
    await AsyncStorage.setItem(KEY, d.uri);
    return d;
}
function sub(dir, name) {
    try { return dir.createDirectory(name); } catch (e) {
        const found = (dir.list?.() || []).find((x) => x instanceof Directory && x.name === name);
        if (found) return found;
        throw e;
    }
}

// Download button: saves invoice-<orderNo>.pdf inside Downloads/<Restaurant>/Invoices/<Month-Year>
export async function saveInvoice(order, setBusy) {
    if (setBusy) setBusy(true);
    try {
        const { file, bytes } = await fetchPdf(order);
        if (Platform.OS !== 'android') { await share(file, order); return; }   // iOS: "Save to Files" in the share sheet
        const parts = pathOf(order);

        try {   // 1) MediaStore: no picker, no permission
            await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
                { name: nameOf(order), parentFolder: parts.join('/'), mimeType: 'application/pdf' },
                'Download',
                decodeURI(file.uri.replace('file://', '')),
            );
            showToast(`Saved in Downloads/${parts.join('/')}`);
            return;
        } catch (e) { /* 2) fall back to the picker */ }

        const put = (base) => {
            let d = base;
            try { parts.forEach((p) => { d = sub(d, p); }); } catch (e) { d = base; }
            d.createFile(nameOf(order), 'application/pdf').write(bytes);
        };
        try { put(await pickBase()); } catch (e) {
            if (e?.cancelled) return;
            await AsyncStorage.removeItem(KEY);
            put(await pickBase());
        }
        showToast(`Saved ${nameOf(order)}`);
    } catch (e) {
        if (e?.response) fail(e);
    } finally { if (setBusy) setBusy(false); }
}