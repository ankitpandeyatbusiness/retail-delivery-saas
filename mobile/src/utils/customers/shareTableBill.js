// The detailed table bill (PDF) for the guest who started the bill: downloaded, then the phone's share sheet opens (WhatsApp, save to Files, and so on).
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api from '../../api/common/client';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export async function shareTableBill(sessionId, table, setBusy) {
    if (setBusy) setBusy(true);
    try {
        const res = await api.get('/dinein/bill/pdf', { params: sessionId ? { sessionId } : {}, responseType: 'arraybuffer' });
        const file = new File(Paths.cache, `table-${String(table || 'bill').replace(/[^\w-]/g, '')}-bill.pdf`);
        if (file.exists) file.delete();
        file.create();
        file.write(new Uint8Array(res.data));
        if (!(await Sharing.isAvailableAsync())) { showToast(tr('Sharing is not available on this device')); return; }
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: tr('Table bill'), UTI: 'com.adobe.pdf' });
    } catch (e) {
        showToast(e?.response?.status === 403 ? tr('Only the guest who started this bill can download it') : tr('Could not get the bill'));
    } finally { if (setBusy) setBusy(false); }
}
