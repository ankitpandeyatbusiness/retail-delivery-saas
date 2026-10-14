// A colourful, readable Excel file for every export (instead of a plain CSV).
//   const buf = await buildSheet({ title, columns, rows, total });
//   columns: [{ header, key, kind, width? }]   kind: text | int | money | date | status | center | wide
//   rows:    [{ [key]: value }]                money in RUPEES, date as a JS Date (shown in India time)
//   total:   true = add a totals line for every money column
// Strings are stored as text, never as formulas, so a customer name like =HYPERLINK(...) stays harmless.
const ExcelJS = require('exceljs');

const C = {
    title: 'FF4F46E5', header: 'FF7C5CFF', headerText: 'FFFFFFFF', zebra: 'FFF5F3FF', border: 'FFE5E7EB',
    note: 'FF6B7280', totalFill: 'FFEDE9FE', totalText: 'FF3730A3', text: 'FF111827',
};
const STATUS = {
    good: ['FFDCFCE7', 'FF166534'],
    wait: ['FFFEF3C7', 'FF92400E'],
    bad: ['FFFEE2E2', 'FF991B1B'],
    info: ['FFDBEAFE', 'FF1E40AF'],
};
const GOOD = /^(paid|done|delivered|in|credit|success|captured|processed|active|sent|live)$/i;
const WAIT = /^(pending|placed|accepted|preparing|ready|out for delivery|out_for_delivery|processing|grace|free|open)$/i;
const BAD = /^(cancelled|void|failed|refunded|out|undelivered|rejected|paused|lost|suspended|expired)$/i;
const tone = (v) => { const s = String(v || '').trim(); return GOOD.test(s) ? STATUS.good : WAIT.test(s) ? STATUS.wait : BAD.test(s) ? STATUS.bad : STATUS.info; };

const IST_MS = 5.5 * 3600 * 1000;
const istDate = (d) => (d ? new Date(new Date(d).getTime() + IST_MS) : null);   // written as UTC so Excel shows India time
const nice = (v) => String(v ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const thin = { style: 'thin', color: { argb: C.border } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

async function buildSheet({ title, subtitle, columns, rows, total = false }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Retail Control';
    wb.created = new Date();
    const ws = wb.addWorksheet(String(title).slice(0, 28), { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });

    // widths from the content, so nothing is cut off and nothing is far too wide
    const widths = columns.map((c) => {
        if (c.width) return c.width;
        let w = String(c.header).length + 4;
        for (const r of rows) {
            const v = r[c.key];
            let len = 0;
            if (v instanceof Date) len = 18;
            else if (c.kind === 'money') len = Number(v || 0).toFixed(2).length + 4;
            else len = String(c.kind === 'status' ? nice(v) : v ?? '').length + 3;
            if (len > w) w = len;
        }
        return Math.min(Math.max(w, c.kind === 'int' ? 10 : 12), c.kind === 'wide' ? 60 : 42);
    });
    ws.columns = columns.map((c, i) => ({ key: c.key, width: widths[i] }));
    const last = columns.length;

    // 1: title banner
    ws.mergeCells(1, 1, 1, last);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: C.headerText } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.title } };
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 34;

    // 2: when and how many
    ws.mergeCells(2, 1, 2, last);
    const n = ws.getCell(2, 1);
    n.value = subtitle || `Made ${new Date(Date.now() + IST_MS).toISOString().replace('T', ' ').slice(0, 16)} (India time)  ·  ${rows.length} row${rows.length === 1 ? '' : 's'}`;
    n.font = { name: 'Calibri', size: 10, italic: true, color: { argb: C.note } };
    n.alignment = { vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 6;

    // 4: header
    const h = ws.getRow(4);
    columns.forEach((c, i) => {
        const cell = h.getCell(i + 1);
        cell.value = c.header;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.headerText } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.header } };
        const right = c.kind === 'money' || c.kind === 'int';
        cell.alignment = { vertical: 'middle', horizontal: right ? 'right' : c.kind === 'status' || c.kind === 'center' || c.kind === 'date' ? 'center' : 'left', wrapText: true, indent: right ? 0 : 1 };
        cell.border = border;
    });
    h.height = 26;

    // data
    rows.forEach((r, ri) => {
        const row = ws.getRow(5 + ri);
        columns.forEach((c, i) => {
            const cell = row.getCell(i + 1);
            const v = r[c.key];
            cell.font = { name: 'Calibri', size: 11, color: { argb: C.text } };
            cell.border = border;
            if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
            if (c.kind === 'money') {
                cell.value = v === null || v === undefined || v === '' ? null : Number(v);
                cell.numFmt = '"₹"#,##0.00';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (c.kind === 'int') {
                cell.value = v === null || v === undefined || v === '' ? null : Number(v);
                cell.numFmt = '0';
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (c.kind === 'date') {
                cell.value = v ? istDate(v) : null;
                cell.numFmt = 'dd mmm yyyy, hh:mm';
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else if (c.kind === 'status') {
                const label = nice(v);
                cell.value = label;
                if (label) {
                    const [bg, fg] = tone(v);
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: fg } };
                }
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else {
                cell.value = v === null || v === undefined ? '' : String(v);   // text only: never a formula
                cell.alignment = { vertical: 'middle', horizontal: c.kind === 'center' ? 'center' : 'left', indent: c.kind === 'center' ? 0 : 1, wrapText: c.kind === 'wide' };
            }
        });
        row.height = 22;
    });

    // totals of the money columns
    if (total && rows.length) {
        const tr = ws.getRow(5 + rows.length);
        columns.forEach((c, i) => {
            const cell = tr.getCell(i + 1);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalFill } };
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.totalText } };
            cell.border = { top: { style: 'medium', color: { argb: C.header } }, bottom: thin, left: thin, right: thin };
            cell.alignment = { vertical: 'middle', horizontal: c.kind === 'money' ? 'right' : 'left', indent: c.kind === 'money' ? 0 : 1 };
            if (i === 0) cell.value = 'Total';
            if (c.kind === 'money') {
                cell.value = Math.round(rows.reduce((a, r) => a + Number(r[c.key] || 0), 0) * 100) / 100;
                cell.numFmt = '"₹"#,##0.00';
            }
        });
        tr.height = 24;
    }

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(rows.length, 1), column: last } };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
module.exports = { buildSheet, XLSX_TYPE };
