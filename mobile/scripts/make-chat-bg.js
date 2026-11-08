// Builds the two chat wallpapers (soft doodles on a transparent tile, repeated across the chat): original drawings, nothing copied.
//
//   node scripts/make-chat-bg.js
//
// Writes assets/chat/chat_bg_light.png and chat_bg_dark.png (320 x 320). The chat draws a plain colour under the tile
// (a warm beige in light mode, a deep green-black in dark mode), so the tile itself is only the faint doodles.
// It needs the `sharp` package: it is borrowed from ../backend/node_modules (run npm install there once).
const fs = require('fs');
const path = require('path');
const sharp = require('../../backend/node_modules/sharp');

const SIZE = 320;
// each doodle is drawn in a 28 x 28 box (stroke only)
const SHAPES = [
    '<path d="M14 24 C2 15 3 6 9 5 C12 4.5 14 7 14 8 C14 7 16 4.5 19 5 C25 6 26 15 14 24Z"/>',                                  // heart
    '<path d="M14 3 L17 11 L25.5 11.5 L19 17 L21 25 L14 20.5 L7 25 L9 17 L2.5 11.5 L11 11Z"/>',                              // star
    '<circle cx="14" cy="14" r="9"/>',                                                                                       // ring
    '<path d="M14 5V23M5 14H23"/>',                                                                                          // plus
    '<path d="M2 14 Q7 6 12 14 T22 14 T27 14"/>',                                                                            // squiggle
    '<path d="M14 4 L25 23 L3 23Z"/>',                                                                                       // triangle
    '<path d="M14 3 L25 14 L14 25 L3 14Z"/>',                                                                                // diamond
    '<path d="M5 6 H23 Q26 6 26 9 V17 Q26 20 23 20 H15 L9 25 V20 H5 Q2 20 2 17 V9 Q2 6 5 6Z"/>',                              // chat bubble
];

// a small repeatable random: the same picture every time the script runs
let seed = 20261108;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function tile(stroke, opacity, width = 1.7) {
    const cells = 4, cell = SIZE / cells;
    let body = '';
    for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
            const shape = SHAPES[(r * 3 + c * 5 + (r + c) % 3) % SHAPES.length];
            const x = c * cell + cell / 2 - 14 + (rnd() - 0.5) * 22;
            const y = r * cell + cell / 2 - 14 + (rnd() - 0.5) * 22;
            const rot = Math.round((rnd() - 0.5) * 70);
            const scale = (0.85 + rnd() * 0.45).toFixed(2);
            body += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot} 14 14) scale(${scale})">${shape}</g>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><g fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}

(async () => {
    const dir = path.join(__dirname, '..', 'assets', 'chat');
    fs.mkdirSync(dir, { recursive: true });
    await sharp(Buffer.from(tile('#5C4628', 0.13))).png().toFile(path.join(dir, 'chat_bg_light.png'));
    seed = 20261108;
    await sharp(Buffer.from(tile('#FFFFFF', 0.26, 2))).png().toFile(path.join(dir, 'chat_bg_dark.png'));
    console.log('wrote chat_bg_light.png and chat_bg_dark.png in', dir);
})();
