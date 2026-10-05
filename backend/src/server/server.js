require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('../database/database');
const authRouter = require('../routes/authRouter');
const tenantRouter = require('../routes/tenantRouter');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Mount Routers
app.use('/api/auth', authRouter);
app.use('/api/tenants', tenantRouter);

const PORT = process.env.PORT || 5000;

// Connect to the database FIRST, then start the server
connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
});