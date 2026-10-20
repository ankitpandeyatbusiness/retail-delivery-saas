// Where a bill is from: a table number, or an unpaid pickup (kept as "Pickup #1234").
export const whereOf = (t) => (/^\d+$/.test(String(t)) ? `table ${t}` : String(t).toLowerCase());
export const WhereOf = (t) => (/^\d+$/.test(String(t)) ? `Table ${t}` : String(t));
