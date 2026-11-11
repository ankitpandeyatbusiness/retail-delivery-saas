// src/components/ui/invoice.js
import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import ReactNativeBlobUtil from 'react-native-blob-util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../api/common/client';
import { showToast } from './shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

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
    const res = await api.get(order.invoicePath || `/orders/${order.id}/invoice`, { responseType: 'arraybuffer' });   // a bulk order brings its own path
    const bytes = new Uint8Array(res.data);
    const file = new File(Paths.cache, nameOf(order));
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return { file, bytes };
}

const fail = (e) => showToast(e?.response?.status === 409 ? tr('The invoice is only available after delivery') : tr('Could not get the invoice'));

async function share(file, order) {
    if (!(await Sharing.isAvailableAsync())) { showToast(tr('Sharing is not available on this device')); return; }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: nameOf(order), UTI: 'com.adobe.pdf' });
}

// The website has no phone PDF viewer or share sheet: View opens the PDF in a new browser tab, Download saves invoice-<no>.pdf with the browser's own download.
async function webInvoice(order, setBusy, mode) {
    const tab = mode === 'view' ? window.open('', '_blank') : null;   // opened at once, on the click, so a pop-up blocker lets it through
    if (setBusy) setBusy(true);
    try {
        const res = await api.get(order.invoicePath || `/orders/${order.id}/invoice`, { responseType: 'arraybuffer' });
        const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        if (mode === 'view') {
            if (tab) tab.location.href = url; else window.open(url, '_blank');
        } else {
            const a = document.createElement('a');
            a.href = url; a.download = nameOf(order);
            document.body.appendChild(a); a.click(); a.remove();
            showToast(tr('Saved {nameOf}', { nameOf: nameOf(order) }));
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (tab) tab.close(); fail(e); } finally { if (setBusy) setBusy(false); }
}

// Tap on an invoice: opens the PDF in the phone's PDF viewer.
export async function viewInvoice(order, setBusy) {
    if (Platform.OS === 'web') return webInvoice(order, setBusy, 'view');
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
    const ok = await ask({ title: tr('Choose a folder'), message: tr('Pick where invoices should be saved, for example Documents. You only do this once.'), confirmText: tr('Choose'), icon: 'folder-open-outline' });
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
    if (Platform.OS === 'web') return webInvoice(order, setBusy, 'save');
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
            showToast(tr('Saved in Downloads/{v1}', { v1: parts.join('/') }));
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
        showToast(tr('Saved {nameOf}', { nameOf: nameOf(order) }));
    } catch (e) {
        if (e?.response) fail(e);
    } finally { if (setBusy) setBusy(false); }
}