require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('./src/models/Tenant');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    await Tenant.findOneAndUpdate(
        { slug: 'burgerking' },
        {
            "slug": "burgerking",
            "name": "Burger King",
            "tagline": "Home of the Whopper",
            "colors": {
                "primary": "#D62300",
                "primaryLight": "#FF4500",
                "primaryDark": "#A31A00",
                "background": "#F8F5F0",
                "text": "#502314",
                "error": "#E21B1B"
            },
            "heroImages": [
                "https://images.unsplash.com/photo-1568901346375-23c9450c58cd",
                "https://images.unsplash.com/photo-1572802419224-296b0aeee0d9"
            ]
        },
        { upsert: true, new: true }
    );
    console.log('✅ Burger King tenant seeded successfully!');
    process.exit();
}).catch(err => {

    console.error(err);
    process.exit(1);
});