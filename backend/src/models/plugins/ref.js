// Gives a model a `ref`: the one quotable reference of the document, made when it is created (see services/refs.js).
//   schema.plugin(refPlugin, { kind: 'order' })     kind: order | bulk | booking | topup | table
// unique: false for a kind whose own code is not guaranteed to be unique in a shop (booking codes).
module.exports = function refPlugin(schema, { kind, unique = true }) {
    schema.add({ ref: { type: String } });
    schema.index({ ref: 1 }, { unique, partialFilterExpression: { ref: { $type: 'string' } } });
    schema.pre('validate', async function assignRef() {
        if (!this.isNew || this.ref) return;
        this.ref = await require('../../services/refs').refFor(kind, this);
    });
};
