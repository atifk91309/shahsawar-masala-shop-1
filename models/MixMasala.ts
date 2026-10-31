import mongoose, { Schema, Document, Types } from "mongoose";

export interface IMixMasala extends Document {
  name: string;
  pricePerKg: number;
  buyPricePerKg?: number;
  recipe: {
    productId: Types.ObjectId;
    productName: string;
    gramsPerKg: number;
  }[];
  userId: Types.ObjectId;
  localId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MixMasalaSchema = new Schema<IMixMasala>({
  name: { type: String, required: true, trim: true },
  pricePerKg: { type: Number, required: true, min: 0 },
  buyPricePerKg: { type: Number, default: 0, min: 0 },
  recipe: [{
    _id: false,
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, required: true, trim: true },
    gramsPerKg: { type: Number, required: true, min: 1 }
  }],
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  localId: { type: String, index: true }
}, { timestamps: true });

// Fast indexes for Shahsawar Masala
MixMasalaSchema.index({ userId: 1, name: 1 }, { unique: true });
MixMasalaSchema.index({ userId: 1, localId: 1 });
MixMasalaSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.MixMasala || mongoose.model<IMixMasala>("MixMasala", MixMasalaSchema);