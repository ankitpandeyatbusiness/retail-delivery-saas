require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('./src/models/Tenant');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    await Tenant.findOneAndUpdate(
        { slug: 'savera' },
        {
            slug: 'savera',
            name: 'Savera',
            tagline: 'Delicious food, delivered to your door',
            colors: {
                primary: '#E23744',
                primaryLight: '#EE4B58',
                primaryDark: '#D42A38',
                background: '#FFFFFF',
                text: '#1C1C1C',
                error: '#C62828'
            },
            heroImages: [
                'https://images.unsplash.com/photo-1504674900247-0877df9cc836',
                'https://images.unsplash.com/photo-1555939594-58d7cb561ad1',
                'https://images.unsplash.com/photo-1493770348161-369560ae357d'
            ]
        },
        { upsert: true, new: true }
    );
    console.log('✅ Savera tenant seeded successfully!');
    process.exit();
}).catch(err => {
    console.error(err);
    process.exit(1);
});