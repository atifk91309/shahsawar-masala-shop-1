import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import MixMasala from "@/models/MixMasala";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaleBody = {
  productId?: string;
  mixId?: string;
  quantity?: number; // old compat
  weightGrams?: number;
  sellPrice?: number;
  pricePerKg?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  buyPricePerKg?: number;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: "cash" | "credit" | "udhar";
  category?: "dryfruit" | "pansar" | "masala_raw" | "masala_mix" | "other";
  saleType?: "loose" | "mix";
  productName?: string;
  localId?: string;
  userId?: string;
};

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

function getDateRange(filter: string): { start: Date; end: Date } | null {
  if (filter === "all") return null;
  const now = new Date();
  const pktOffset = 5 * 60 * 60 * 1000;
  const nowPKT = new Date(now.getTime() + pktOffset);
  const y = nowPKT.getUTCFullYear(), m = nowPKT.getUTCMonth(), d = nowPKT.getUTCDate();
  const startToday = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - pktOffset);
  const endToday = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0) - pktOffset);
  
  if (filter === "yesterday") {
    const s = new Date(Date.UTC(y, m, d-1, 0, 0, 0, 0) - pktOffset);
    const e = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - pktOffset);
    return { start: s, end: e };
  } else if (filter === "weekly") {
    const weekStart = new Date(startToday.getTime() - 7*24*60*60*1000);
    return { start: weekStart, end: endToday };
  } else if (filter === "monthly") {
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - pktOffset);
    return { start: monthStart, end: endToday };
  }
  return { start: startToday, end: endToday };
}

type SaleQuery = {
  userId: Types.ObjectId;
  createdAt?: { $gte?: Date; $lte?: Date; $lt?: Date };
  category?: string;
  saleType?: string;
  paymentType?: string;
  $or?: Array<{ productName?: { $regex: string; $options: string }; customerName?: { $regex: string; $options: string } }>;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
    }
    await dbConnect();
    const sp = req.nextUrl.searchParams;
    const filter = sp.get("filter") || "today";
    const search = sp.get("search")?.trim() || "";
    const category = sp.get("category") || "";
    const saleType = sp.get("saleType") || "";
    const rawPaymentType = sp.get("paymentType") || sp.get("type") || "";
    const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;
    const userId = new Types.ObjectId(session.user.id);

    const range = getDateRange(filter);
    const q: SaleQuery = { userId };

    if (range) {
      if (filter === "yesterday") q.createdAt = { $gte: range.start, $lte: range.end };
      else q.createdAt = { $gte: range.start, $lt: range.end };
    }
    if (search) {
      q.$or = [
        { productName: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
      ];
    }
    if (category && category !== "all") q.category = category;
    if (saleType && saleType !== "all") q.saleType = saleType;
    
    if (rawPaymentType && rawPaymentType !== "all") {
      const mapped = rawPaymentType === "udhar" ? "credit" : rawPaymentType;
      if (mapped === "cash" || mapped === "credit") {
        q.paymentType = mapped;
      }
    }

    const [sales, totalCount, agg] = await Promise.all([
      Sale.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Sale.countDocuments(q),
      Sale.aggregate([{ $match: q }, { $group: { _id: null, total: { $sum: "$total" }, profit: { $sum: "$profit" } } }]),
    ]);

    const firstAgg = agg[0] as { total?: number; profit?: number } | undefined;

    return NextResponse.json({
      sales,
      total: rnd(firstAgg?.total || 0),
      profit: rnd(firstAgg?.profit || 0),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: skip + sales.length < totalCount,
      },
    });
  } catch (e) {
    console.error("GET /api/sales error:", e);
    return NextResponse.json({ sales: [], total: 0, profit: 0, pagination: { page: 1, totalPages: 1, hasMore: false, totalCount: 0 } });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    await dbConnect();
    const body = (await req.json()) as SaleBody;

    const weightGrams = rnd(body.weightGrams || (body.quantity ? body.quantity * 1000 : 0) || 100);
    if (!weightGrams) {
      return NextResponse.json({ error: "weightGrams required" }, { status: 400 });
    }

    let userId: Types.ObjectId;
    if (session?.user?.id && Types.ObjectId.isValid(session.user.id)) {
      userId = new Types.ObjectId(session.user.id);
    } else if (body.userId && Types.ObjectId.isValid(body.userId)) {
      userId = new Types.ObjectId(body.userId);
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (body.localId) {
      const exists = await Sale.findOne({ localId: body.localId, userId }).lean();
      if (exists) return NextResponse.json(exists, { status: 200 });
    }

    let productName = body.productName || "Product";
    let productCategory = body.category || "pansar";
    let saleType = body.saleType || "loose";

    // LOOSE: Kajoor, Kishmish, Mong Pali
    if (body.productId && Types.ObjectId.isValid(body.productId)) {
      try {
        const product = await Product.findOne({ _id: body.productId, userId });
        if (product) {
          productName = product.name;
          productCategory = product.category as typeof productCategory;
          saleType = "loose";
          if (product.stockMode === "limited" && product.stockInGrams < weightGrams) {
            return NextResponse.json({ error: `Only ${product.stockInGrams}g left for ${product.name}` }, { status: 400 });
          }
          if (product.stockMode === "limited") {
            product.stockInGrams = rnd(product.stockInGrams - weightGrams);
            await product.save();
          }
        }
      } catch {}
    }

    // MIX: Salan Masala, Garam Masala - deduct recipe
    if (body.mixId && Types.ObjectId.isValid(body.mixId)) {
      try {
        const mix = await MixMasala.findOne({ _id: body.mixId, userId });
        if (mix) {
          productName = mix.name;
          productCategory = "masala_mix";
          saleType = "mix";
          for (const item of mix.recipe) {
            const gramsNeeded = rnd((item.gramsPerKg * weightGrams) / 1000);
            const rawProduct = await Product.findOne({ _id: item.productId, userId });
            if (rawProduct && rawProduct.stockMode === "limited") {
              if (rawProduct.stockInGrams < gramsNeeded) {
                return NextResponse.json({ error: `Low stock: ${rawProduct.name} needs ${gramsNeeded}g for ${mix.name}` }, { status: 400 });
              }
            }
          }
          // Deduct after all checks pass
          for (const item of mix.recipe) {
            const gramsNeeded = rnd((item.gramsPerKg * weightGrams) / 1000);
            const rawProduct = await Product.findOne({ _id: item.productId, userId });
            if (rawProduct && rawProduct.stockMode === "limited") {
              rawProduct.stockInGrams = rnd(rawProduct.stockInGrams - gramsNeeded);
              await rawProduct.save();
            }
          }
        }
      } catch {}
    }

    const pricePerKg = rnd(body.pricePerKg || body.sellPrice || 0);
    const buyPerKg = rnd(body.buyPricePerKg || body.buyPriceAvg || body.buyPrice || 0);
    const weightKg = weightGrams / 1000;
    const total = rnd(pricePerKg * weightKg);
    const profit = rnd((pricePerKg - buyPerKg) * weightKg);
    const isCredit = body.paymentType === "credit" || body.paymentType === "udhar";
    const customerName = body.customerName?.trim() || "Walk-in";

    if (isCredit && customerName.toLowerCase() === "walk-in") {
      return NextResponse.json({ error: "Customer name required for Udhar" }, { status: 400 });
    }

    const sale = await Sale.create({
      productId: body.productId && Types.ObjectId.isValid(body.productId) ? new Types.ObjectId(body.productId) : undefined,
      mixId: body.mixId && Types.ObjectId.isValid(body.mixId) ? new Types.ObjectId(body.mixId) : undefined,
      productName,
      category: productCategory,
      saleType,
      weightGrams,
      pricePerKg,
      buyPricePerKg: buyPerKg,
      buyPriceAvg: buyPerKg,
      sellPrice: pricePerKg,
      quantity: weightKg,
      total,
      profit,
      customerName,
      paymentType: isCredit ? "credit" : "cash",
      status: isCredit ? "pending" : "paid",
      userId,
      localId: body.localId || `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });

    if (isCredit) {
      const norm = customerName.toLowerCase();
      await Customer.findOneAndUpdate(
        { userId, normalizedName: norm, isPaid: false },
        {
          $setOnInsert: {
            name: customerName,
            normalizedName: norm,
            phone: body.phone || "",
            village: body.village || "",
            userId,
            paidAmount: 0,
            wusoolHistory: [],
            localId: `cust_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          },
          $inc: { totalUdhar: total, totalBusiness: total, billsCount: 1 },
          $set: { lastUdharDate: new Date() },
          $addToSet: { saleIds: sale._id },
        },
        { upsert: true, new: true }
      );
    }

    return NextResponse.json(sale, { status: 201 });
  } catch (e) {
    console.error("POST /api/sales error:", e);
    return NextResponse.json({ error: "Failed to create sale" }, { status: 500 });
  }
}