import mongoose, { Schema, Document, Types } from "mongoose";

export type SaleCategory = "dryfruit" | "pansar" | "masala_raw" | "masala_mix" | "other";
export type PaymentType = "cash" | "credit";
export type SaleStatus = "paid" | "pending";
export type SaleType = "loose" | "mix";

export interface ISale extends Document {
  productId?: Types.ObjectId;
  mixId?: Types.ObjectId;
  productName: string;
  category: SaleCategory;
  saleType: SaleType;
  weightGrams: number;
  pricePerKg: number;
  buyPricePerKg: number;
  buyPriceAvg: number;
  buyPrice?: number;
  sellPrice: number;
  quantity: number;
  total: number;
  profit: number;
  customerName: string;
  paymentType: PaymentType;
  status: SaleStatus;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SaleSchema = new Schema<ISale>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", sparse: true },
    mixId: { type: Schema.Types.ObjectId, ref: "MixMasala", sparse: true },
    productName: { type: String, required: true, trim: true, index: true },
    category: {
      type: String,
      enum: ["dryfruit", "pansar", "masala_raw", "masala_mix", "other"],
      default: "pansar",
      index: true
    },
    saleType: {
      type: String,
      enum: ["loose", "mix"],
      default: "loose",
      index: true
    },
    weightGrams: { type: Number, required: true, min: 1 },
    pricePerKg: { type: Number, required: true, min: 0 },
    buyPricePerKg: { type: Number, default: 0, min: 0 },
    buyPriceAvg: { type: Number, default: 0, min: 0 },
    buyPrice: { type: Number, default: 0, min: 0 },
    sellPrice: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, default: 1, min: 0 },
    total: { type: Number, required: true, min: 0 },
    profit: { type: Number, required: true },
    customerName: { type: String, default: "Walk-in", trim: true },
    paymentType: { type: String, enum: ["cash", "credit"], default: "cash" },
    status: { type: String, enum: ["paid", "pending"], default: "paid", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    localId: { type: String, sparse: true },
    synced: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SaleSchema.pre("validate", function () {
  const weightKg = (this.weightGrams || 0) / 1000;
  const sellPerKg = Math.round(Number(this.pricePerKg) || 0);
  const buyPerKg = Math.round(Number(this.buyPricePerKg || this.buyPriceAvg) || 0);

  this.pricePerKg = sellPerKg;
  this.buyPricePerKg = buyPerKg;
  this.buyPriceAvg = buyPerKg;
  this.sellPrice = sellPerKg;
  this.quantity = weightKg;

  if (!this.total || this.isModified("weightGrams") || this.isModified("pricePerKg")) {
    this.total = Math.round(weightKg * sellPerKg);
  }
  
  if (this.profit || this.isModified("weightGrams") || this.isModified("pricePerKg") || this.isModified("buyPricePerKg")) {
    this.profit = Math.round(weightKg * (sellPerKg - buyPerKg));
  } else {
    this.profit = Math.round(weightKg * (sellPerKg - buyPerKg));
  }

  this.status = this.paymentType === "credit" ? "pending" : "paid";
});

SaleSchema.index({ userId: 1, createdAt: -1 });
SaleSchema.index({ userId: 1, category: 1, createdAt: -1 });
SaleSchema.index({ userId: 1, status: 1 });
SaleSchema.index({ userId: 1, localId: 1 }, { sparse: true, unique: true });
SaleSchema.index({ localId: 1 }, { sparse: true });

export default mongoose.models.Sale || mongoose.model<ISale>("Sale", SaleSchema)