// The owner's order board: a delivery order stays "preparing" on the server until the rider collects it, but once the cook (or the owner) has marked the
// food ready it belongs in the Ready column. These give that board status for counting and for listing.
//   statusExpr       an aggregation expression: 'ready' for a packed delivery order, the real status otherwise
//   boardFilter(l)   a find() filter for a list of board statuses, e.g. ['ready'] or ['preparing', 'ready']
const packed = { $and: [{ $eq: ['$status', 'preparing'] }, { $eq: ['$orderType', 'delivery'] }, { $gt: ['$kitchen.readyAt', null] }] };
const statusExpr = { $cond: [packed, 'ready', '$status'] };

const PACKED = { status: 'preparing', orderType: 'delivery', 'kitchen.readyAt': { $exists: true, $ne: null } };

function boardFilter(list) {
    const ors = [];
    for (const s of list) {
        if (s === 'ready') ors.push({ status: 'ready' }, PACKED);
        else if (s === 'preparing') ors.push({ status: 'preparing', $nor: [PACKED] });
        else ors.push({ status: s });
    }
    return ors.length === 1 ? ors[0] : { $or: ors };
}

// the same decision for one order document
const boardStatusOf = (o) => (o.status === 'preparing' && o.orderType === 'delivery' && o.kitchen?.readyAt ? 'ready' : o.status);

module.exports = { statusExpr, boardFilter, boardStatusOf };
