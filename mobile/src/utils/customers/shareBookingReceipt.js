// The receipt of a table booking deposit (PDF), for the guest and for the owner: downloaded, then the phone's share sheet opens (WhatsApp, save to Files, and so on).
// path: '/bookings/:id/receipt' for the guest, '/shop/booking/:id/receipt' for the owner.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api from '../../api/common/client';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export async function shareBookingReceipt(path, code, setBusy) {
    if (setBusy) setBusy(true);
    try {
        const res = await api.get(path, { responseType: 'arraybuffer' });
        const file = new File(Paths.cache, `booking-${String(code || 'receipt').replace(/[^\w-]/g, '')}-receipt.pdf`);
        if (file.exists) file.delete();
        file.create();
        file.write(new Uint8Array(res.data));
        if (!(await Sharing.isAvailableAsync())) { showToast(tr('Sharing is not available on this device')); return; }
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: tr('Booking receipt'), UTI: 'com.adobe.pdf' });
    } catch (e) {
        showToast(e?.response?.status === 404 ? tr('No deposit was paid for this booking') : tr('Could not get the receipt'));
    } finally { if (setBusy) setBusy(false); }
}

// a receipt exists once the deposit was paid (a booking that was never paid has none)
export const hasReceipt = (b) => !!b?.payment?.rzpPaymentId;
