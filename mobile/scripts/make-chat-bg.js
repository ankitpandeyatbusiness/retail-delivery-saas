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

// the landscape wallpaper (phones turned sideways, and the website): a wider tile, with food doodles among the shapes
const FOOD = [
    '<path d="M5 9H20V17Q20 23 13 23Q5 23 5 17Z M20 11H23Q26 11 26 14T23 17H20 M9 3Q10 5 9 6.5 M14 3Q15 5 14 6.5"/>',            // cup
    '<path d="M3 13H25Q25 23 14 23Q3 23 3 13Z M8 8Q10 5 12 8 M15 8Q17 5 19 8"/>',                                                // bowl
    '<path d="M3 6Q14 1 25 6L14 25Z"/><circle cx="12" cy="10" r="1.5"/><circle cx="17" cy="11" r="1.5"/>',                       // pizza
    '<path d="M9 3V10Q9 13 12 13V25M15 3V10M12 3V13"/>',                                                                         // fork
    '<path d="M4 11Q4 4 14 4Q24 4 24 11Z M3 15H25 M4 19H24Q24 24 14 24Q4 24 4 19Z"/>',                                           // burger
];
const WIDE = 960, HIGH = 480;

function tile(stroke, opacity, width = 1.7, W = SIZE, H = SIZE, pool = SHAPES) {
    const cell = 80, cols = W / cell, rows = H / cell;   // (the square tile keeps its 4 x 4 cells of 80)
    let body = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const shape = pool[(r * 3 + c * 5 + (r + c) % 3) % pool.length];
            const x = c * cell + cell / 2 - 14 + (rnd() - 0.5) * 22;
            const y = r * cell + cell / 2 - 14 + (rnd() - 0.5) * 22;
            const rot = Math.round((rnd() - 0.5) * 70);
            const scale = (0.85 + rnd() * 0.45).toFixed(2);
            body += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot} 14 14) scale(${scale})">${shape}</g>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
}

(async () => {
    const dir = path.join(__dirname, '..', 'assets', 'chat');
    fs.mkdirSync(dir, { recursive: true });
    await sharp(Buffer.from(tile('#5C4628', 0.13))).png().toFile(path.join(dir, 'chat_bg_light.png'));
    seed = 20261108;
    await sharp(Buffer.from(tile('#FFFFFF', 0.26, 2))).png().toFile(path.join(dir, 'chat_bg_dark.png'));
    // the landscape pair: shapes and food together, spread over a wide tile
    const MIX = [...SHAPES, ...FOOD, ...FOOD];
    seed = 20261112;
    await sharp(Buffer.from(tile('#5C4628', 0.13, 1.7, WIDE, HIGH, MIX))).png().toFile(path.join(dir, 'chat_bg_land_light.png'));
    seed = 20261112;
    await sharp(Buffer.from(tile('#FFFFFF', 0.26, 2, WIDE, HIGH, MIX))).png().toFile(path.join(dir, 'chat_bg_land_dark.png'));
    console.log('wrote chat_bg_light.png, chat_bg_dark.png and the landscape pair in', dir);
})();
