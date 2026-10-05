const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('MONGODB_URI is not defined in the environment variables.');
        }

        const conn = await mongoose.connect(uri);
        console.log(`✅ MongoDB connected successfully`);
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        // Exit process with failure
        process.exit(1);
    }
};

module.exports = connectDB;