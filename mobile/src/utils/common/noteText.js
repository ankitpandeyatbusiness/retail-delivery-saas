// An order's note is a few pieces joined with " | ": the guest's quick choices ("Make it spicy"), then what he typed. The quick choices
// are saved in English; the cook, waiter and owner see each piece in their own language (what the guest typed stays as written).
import { tr } from '../../i18n';

export const trNote = (note) => (typeof note === 'string' && note ? note.split(' | ').map((p) => tr(p)).join(' | ') : note);
