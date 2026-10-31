// Which picture a category shows to customers. The owner chooses per category (Category.imageSource):
//   auto  its own picture; with none, the picture of one of its dishes          (the recommended way)
//   own   only its own picture; with none, the big first letter of its name
//   dish  a picture of its dishes (the first dish that has one, and the next if that one is gone), then its own; with none, the letter
// "A picture of its dishes" = the earliest-added active dish of the category that has a picture; if that dish has none the next one is used, and so on.
// With nothing at all the answer is '' and the app draws the first letter.
const SOURCES = ['auto', 'own', 'dish'];

const needsDish = (c) => {
    const src = c.imageSource || 'auto';
    return src === 'dish' || (src === 'auto' && !c.image);
};

const effective = (c, dishImage) => {
    const src = c.imageSource || 'auto';
    if (src === 'own') return c.image || '';
    if (src === 'dish') return dishImage || c.image || '';
    return c.image || dishImage || '';
};

module.exports = { SOURCES, needsDish, effective };
