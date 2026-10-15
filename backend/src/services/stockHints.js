// What a customer may know about stock: never the real number, only whether "few are left".
//   fewLeft  true when the item is running low (the app shows a "Few left" tag)
//   maxQty   the most that can be ordered right now (pieces, or g / ml for items sold by weight / volume).
//            The app uses it to stop the + button and the amount picker; it is not shown as a number.
// The stock count itself is removed from everything a customer receives.

// "low" means: at most this much in absolute terms, or a quarter of what the day started with
const FEW_ABS = { piece: 3, weight: 1000, volume: 1000 };

// Mutates a lean product and returns it.
function publicProduct(p) {
    if (!p) return p;
    const st = p.stock;
    delete p.stock;
    if (st && st.enabled && st.qty > 0) {
        const kind = p.sellBy || 'piece';
        const base = Number.isFinite(st.dailyQty) && st.dailyQty > 0 ? st.dailyQty : 0;
        p.fewLeft = st.qty <= Math.max(FEW_ABS[kind] ?? 3, Math.ceil(base * 0.25));
        p.maxQty = st.qty;
    }
    return p;
}

module.exports = { publicProduct, FEW_ABS };
