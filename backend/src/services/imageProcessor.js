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

module.exports = { toWebp };