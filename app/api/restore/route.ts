import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import MixMasala from "@/models/MixMasala";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BackupBase = {
  _id?: string;
  localId?: string;
  userId?: string | Types.ObjectId;
  name?: string;
};

type BackupProduct = BackupBase & {
  category?: "dryfruit" | "pansar" | "masala_raw" | "masala_mix";
  pricePerKg?: number;
  buyPricePerKg?: number;
  stockInGrams?: number;
  stockMode?: string;
};

type BackupSale = BackupBase & {
  productId?: string;
  mixId?: string;
  productName?: string;
  category?: string;
  saleType?: "loose" | "mix";
  weightGrams?: number;
  pricePerKg?: number;
  buyPricePerKg?: number;
  total?: number;
  profit?: number;
  __v?: number;
};

type BackupMix = BackupBase & {
  recipe?: { productId: string; gramsPerKg: number }[];
  pricePerKg?: number;
};

type BackupCustomer = BackupBase & {
  normalizedName?: string;
  totalBusiness?: number;
  totalUdhar?: number;
  paidAmount?: number;
  saleIds?: (string | Types.ObjectId)[];
  billsCount?: number;
  wusoolHistory?: { amount: number; date?: string }[];
  isPaid?: boolean;
};

type RestorePayload = {
  data?: {
    products?: BackupProduct[];
    sales?: BackupSale[];
    mixMasala?: BackupMix[];
    customers?: BackupCustomer[];
  };
  products?: BackupProduct[];
  sales?: BackupSale[];
  mixMasala?: BackupMix[];
  customers?: BackupCustomer[];
};

type RestoredCount = { products: number; sales: number; mixMasala: number; customers: number };

function getUserIdString(item: BackupBase): string | undefined {
  if (!item.userId) return undefined;
  return item.userId.toString();
}

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = (await req.json()) as RestorePayload;
    const src = body.data ? body.data : body;

    const products = src.products ?? [];
    const sales = src.sales ?? [];
    const mixMasala = src.mixMasala ?? [];
    const customers = src.customers ?? [];

    const restored: RestoredCount = { products: 0, sales: 0, mixMasala: 0, customers: 0 };
    const skipped: RestoredCount = { products: 0, sales: 0, mixMasala: 0, customers: 0 };

    // 1. PRODUCTS - Masala system
    for (const p of products) {
      const userIdStr = getUserIdString(p);
      const nameVal = p.name;
      let exists = null;

      try {
        if (p._id && Types.ObjectId.isValid(p._id)) {
          exists = await Product.findById(p._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && p.localId && userIdStr) {
        exists = await Product.findOne({ localId: p.localId, userId: userIdStr }).lean();
      }
      if (!exists && nameVal && userIdStr) {
        exists = await Product.findOne({ name: nameVal, userId: userIdStr }).lean();
      }

      if (!exists) {
        try {
          const { _id, ...rest } = p;
          void _id;
          await Product.create({
            ...rest,
            pricePerKg: rnd(rest.pricePerKg || 0),
            buyPricePerKg: rnd(rest.buyPricePerKg || 0),
            stockInGrams: rnd(rest.stockInGrams || 0),
          });
          restored.products++;
        } catch {
          skipped.products++;
        }
      } else {
        skipped.products++;
      }
    }

    // 2. MIX MASALA - Salan, Garam
    for (const m of mixMasala) {
      let exists = null;
      try {
        if (m._id && Types.ObjectId.isValid(m._id)) {
          exists = await MixMasala.findById(m._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && m.localId) {
        const uid = getUserIdString(m);
        if (uid) exists = await MixMasala.findOne({ localId: m.localId, userId: uid }).lean();
      }

      if (!exists) {
        try {
          const { _id, __v, ...rest } = m as BackupMix & { _id?: string; __v?: number };
          void _id; void __v;
          await MixMasala.create(rest);
          restored.mixMasala++;
        } catch {
          skipped.mixMasala++;
        }
      } else {
        skipped.mixMasala++;
      }
    }

    // 3. SALES - weightGrams system
    for (const s of sales) {
      let exists = null;
      try {
        if (s._id && Types.ObjectId.isValid(s._id)) {
          exists = await Sale.findById(s._id).lean();
        }
      } catch { /* ignore */ }

      if (!exists && s.localId) {
        const uid = getUserIdString(s);
        if (uid) exists = await Sale.findOne({ localId: s.localId, userId: uid }).lean();
      }

      if (!exists) {
        try {
          const { _id, __v, ...rest } = s as BackupSale & { _id?: string; __v?: number };
          void _id; void __v;
          await Sale.create(rest);
          restored.sales++;
        } catch {
          skipped.sales++;
        }
      } else {
        skipped.sales++;
      }
    }

    // 4. CUSTOMERS - Khata
    for (const c of customers) {
      const norm = (c.normalizedName || c.name || "").trim().toLowerCase();
      const userIdStr = getUserIdString(c);
      if (!norm || !userIdStr) { skipped.customers++; continue; }

      const srcHistory = c.wusoolHistory ?? [];
      const totalWusool = srcHistory.reduce((sum: number, h: { amount: number }) => sum + (Number(h.amount) || 0), 0);
      const totalBusiness = Number(c.totalBusiness) || Number(c.totalUdhar) || 0;
      const remaining = Math.max(0, totalBusiness - totalWusool);

      const existing = await Customer.findOne({ userId: userIdStr, normalizedName: norm, isPaid: false });

      if (existing) {
        existing.totalBusiness = totalBusiness;
        existing.totalUdhar = remaining;
        existing.paidAmount = totalWusool;
        existing.wusoolHistory = srcHistory as unknown as typeof existing.wusoolHistory;

        if (c.saleIds?.length) {
          const existingIds = (existing.saleIds || []).map((id: Types.ObjectId | string) => id.toString());
          const newIds = c.saleIds.map((id: string | Types.ObjectId) => id.toString());
          const merged = new Set<string>([...existingIds, ...newIds]);
          existing.saleIds = Array.from(merged).map((id: string) => new Types.ObjectId(id)) as unknown as typeof existing.saleIds;
        }
        existing.billsCount = existing.saleIds?.length || c.billsCount || 0;
        await existing.save();
        restored.customers++;
      } else {
        try {
          let byId = null;
          try {
            if (c._id && Types.ObjectId.isValid(c._id)) {
              byId = await Customer.findById(c._id).lean();
            }
          } catch { /* ignore */ }

          if (!byId) {
            const { _id, ...rest } = c as BackupCustomer & { _id?: string };
            void _id;
            await Customer.create({
              ...rest,
              normalizedName: norm,
              totalBusiness,
              totalUdhar: remaining,
              paidAmount: totalWusool,
              wusoolHistory: srcHistory,
              isPaid: remaining <= 0.01,
            });
            restored.customers++;
          } else {
            skipped.customers++;
          }
        } catch {
          skipped.customers++;
        }
      }
    }

    return NextResponse.json({ success: true, restored, skipped, message: "Shahsawar Masala backup restored" });
  } catch (e) {
    console.error("Restore error:", e);
    const msg = e instanceof Error ? e.message : "Restore failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}