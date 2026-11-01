// Day and month names in the app's language, for dates written as "YYYY-MM-DD" (the phone's own language is not used: the
// app language the person chose is).
import { tr } from '../../i18n';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const at = (ymd) => new Date(`${ymd}T12:00:00Z`);

export const weekdayShort = (ymd) => tr(WEEK[at(ymd).getUTCDay()]);                                   // "Mon"
export const dayMonthShort = (ymd) => { const d = at(ymd); return `${d.getUTCDate()} ${tr(MONTH[d.getUTCMonth()])}`; };   // "5 Nov"
export const niceDate = (ymd) => `${weekdayShort(ymd)}, ${dayMonthShort(ymd)}`;                        // "Mon, 5 Nov"
