import mongoose, { Schema, Document, Types } from "mongoose";

export type PansarCategory = "dryfruit" | "pansar" | "masala_raw" | "masala_mix";
export type StockMode = "limited" | "unlimited";

export interface IProduct extends Document {
  name: string;
  category: PansarCategory;
  pricePerKg: number;
  buyPricePerKg: number;
  stockInGrams: number;
  // compat fields for old Asad Mobile code
  buyPriceAvg: number;
  sellPrice: number;
  stock: number;
  stockMode: StockMode;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true, trim: true },
  category: { 
    type: String, 
    enum: ["dryfruit", "pansar", "masala_raw", "masala_mix"], 
    default: "pansar", 
    index: true 
  },
  
  pricePerKg: { type: Number, required: true, min: 0 },
  buyPricePerKg: { type: Number, default: 0, min: 0 },
  stockInGrams: { type: Number, default: 0, min: 0 },

  buyPriceAvg: { type: Number, default: 0, min: 0 },
  sellPrice: { type: Number, default: 0, min: 0 },
  stock: { type: Number, default: 0, min: 0 },

  stockMode: { 
    type: String, 
    enum: ["limited","unlimited"], 
    default: "limited",
    index: true 
  },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  localId: { type: String, sparse: true },
  synced: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: Date.now },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// FAST INDEXES - Shahsawar Masala optimized
ProductSchema.index({ userId: 1, name: 1 }, { unique: true });
ProductSchema.index({ userId: 1, category: 1, createdAt: -1 });
ProductSchema.index({ userId: 1, stockInGrams: 1 });
ProductSchema.index({ userId: 1, pricePerKg: 1 });
ProductSchema.index({ userId: 1, localId: 1 });
ProductSchema.index({ name: "text" });

ProductSchema.virtual("profitPerKg").get(function(this: IProduct){
  return Math.round((this.pricePerKg || 0) - (this.buyPricePerKg || 0));
});

ProductSchema.virtual("stockInKg").get(function(this: IProduct){
  return (this.stockInGrams || 0) / 1000;
});

ProductSchema.virtual("totalBuyValue").get(function(this: IProduct){
  if (this.stockMode === "unlimited") return 0;
  return Math.round((this.stockInGrams/1000) * (this.buyPricePerKg || 0));
});

ProductSchema.virtual("totalSellValue").get(function(this: IProduct){
  if (this.stockMode === "unlimited") return 0;
  return Math.round((this.stockInGrams/1000) * (this.pricePerKg || 0));
});

ProductSchema.pre("save", function() {
  // keep old fields synced for reports
  this.sellPrice = Math.round(this.pricePerKg || 0);
  this.buyPriceAvg = Math.round(this.buyPricePerKg || 0);
  this.stock = this.stockMode === "unlimited" ? 9999 : Math.round((this.stockInGrams || 0) / 1000);
  this.pricePerKg = Math.round(this.pricePerKg || 0);
  this.buyPricePerKg = Math.round(this.buyPricePerKg || 0);
  this.stockInGrams = Math.round(this.stockInGrams || 0);
});

export default mongoose.models.Product || mongoose.model<IProduct>("Product", ProductSchema);