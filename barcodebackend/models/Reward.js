// barcode/barcodebackend/models/Reward.js
const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  pointsRequired: { type: Number, required: true, min: 1 },
  image: { type: String }, // Base64 or URL for reward image
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Reward', rewardSchema);