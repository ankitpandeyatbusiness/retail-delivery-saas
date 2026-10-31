// Reads an Excel download (services/xlsxExport.js layout: title, note, gap, header on row 4, then the rows).
// Usage: const { res, header, rows, text } = await readSheet(request(app).get(url).set(headers));
const ExcelJS = require('exceljs');

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
const cellText = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return v.toFixed(2);
    if (typeof v === 'object' && v.formula) return 'FORMULA:' + v.formula;   // a real formula cell (a test can make sure there is none)
    if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : ''));
    return String(v);
};

async function readSheet(req) {
    const res = await req.buffer(true).parse(binary);
    if (res.status !== 200) return { res, header: [], rows: [], text: '' };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0];
    const all = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => { if (n >= 4) all.push(row.values.slice(1).map(cellText)); });
    const [header = [], ...rows] = all;
    return { res, header, rows, text: all.map((r) => r.join(',')).join('\n') };
}

module.exports = { readSheet };
