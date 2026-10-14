// Turns any uploaded jpeg/png/webp into a clean WebP:
// rotated by EXIF, metadata stripped, longest side limited, quality 80.
let sharp;
const lib = () => {
    if (!sharp) {
        try { sharp = require('sharp'); } catch { throw new Error('sharp is not installed. Run: npm install sharp'); }
    }
    return sharp;
};

async function toWebp(buffer, { maxSide = 1600, quality = 80 } = {}) {
    const { data, info } = await lib()(buffer, { limitInputPixels: 50_000_000, failOn: 'error' })
        .rotate()                                   // apply EXIF orientation, then EXIF is dropped
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, bytes: info.size };
}

// App icon, adaptive icon and splash must stay PNG (the app stores need it).
// square: the picture must already be square and is scaled to exactly size x size.
// flatten: remove transparency (the iOS icon must not have any).
async function toPng(buffer, { size, maxSide = 1600, square = false, flatten = false } = {}) {
    const meta = await lib()(buffer, { limitInputPixels: 50_000_000, failOn: 'error' }).metadata();
    if (square && meta.width !== meta.height) {
        const e = new Error('This image must be square (for example 1024 x 1024)');
        e.userFacing = true;
        throw e;
    }
    let img = lib()(buffer, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate();
    img = size
        ? img.resize({ width: size, height: size, fit: 'fill' })
        : img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    if (flatten) img = img.flatten({ background: '#ffffff' });
    const { data, info } = await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, bytes: info.size };
}

module.exports = { toWebp, toPng };