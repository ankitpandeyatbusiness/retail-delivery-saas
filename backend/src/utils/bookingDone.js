// "This booking is already ..." with the status as a whole fixed sentence, so each one can be translated.
const { httpError } = require('../middlewares/apiErrors');

function bookingDone(status) {
    switch (status) {
        case 'held': return httpError(400, 'This booking is already on hold');
        case 'confirmed': return httpError(400, 'This booking is already confirmed');
        case 'seated': return httpError(400, 'This booking is already seated');
        case 'no_show': return httpError(400, 'This booking is already marked no show');
        case 'cancelled': return httpError(400, 'This booking is already cancelled');
        case 'expired': return httpError(400, 'This booking is already expired');
        default: return httpError(400, 'This booking is already closed');
    }
}

module.exports = { bookingDone };
