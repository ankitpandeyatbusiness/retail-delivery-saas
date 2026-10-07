const { pickBrandColors } = require('../src/services/logoColors');

pickBrandColors(process.argv[2])
    .then((c) => console.log(c || 'No usable colour found in this logo'))
    .catch((e) => console.error('Could not read the image:', e.message));