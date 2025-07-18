// barcode/barcodebackend/models/Notification.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for admin notifications
  message: { type: String, required: true },
  type: { type: String, enum: ['reward_achievement', 'redemption_request', 'other'], default: 'other' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Notification', notificationSchema);
