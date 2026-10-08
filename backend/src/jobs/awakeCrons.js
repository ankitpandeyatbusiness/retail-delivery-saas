// src/jobs/awakeCrons.js
const cron = require('node-cron');
const https = require('https');

const startAwakeCron = () => {
    console.log('⏰ Awake cron job initialized and running...');

    // Runs every 14 minutes to prevent the 15-minute idle sleep on free tiers
    cron.schedule('*/14 * * * *', () => {
        // Replace with your actual production URL, or use an environment variable
        const url = process.env.SERVER_URL || 'https://retail-delivery-saas-backend.onrender.com';

        console.log('Pinging server to keep awake...');

        https.get(url, (res) => {
            if (res.statusCode === 200) {
                console.log(`Server successfully pinged. Status: ${res.statusCode}`);
            } else {
                console.error(`Awake ping failed with status: ${res.statusCode}`);
            }
        }).on('error', (err) => {
            console.error(`Awake ping error: ${err.message}`);
        });
    });
};

module.exports = startAwakeCron;