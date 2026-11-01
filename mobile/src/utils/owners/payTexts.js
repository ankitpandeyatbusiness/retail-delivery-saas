// How a rider is paid is written by the server in English (with the amounts inside). This list only lets the translation build know the
// sentences; the owner's rider screens translate them with tr() and the phone matches the amounts as values.
import { tl } from '../../i18n';

export const PAY_TEXTS = [
    tl('Salary {a} every {p}'),
    tl('{a} for each delivery'),
    tl('{n}% of each order'),
    tl('{a} + {b} per km after {k} km for each delivery'),
    tl('Salary {a} every {p} + {b} for each delivery'),
    tl('Paid outside the app'),
    tl('day'), tl('week'), tl('month'),
];
