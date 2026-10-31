import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import Sale from "@/models/Sale";
import Customer from "@/models/Customer";
import MixMasala from "@/models/MixMasala";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type SaleUpdateBody = {
  weightGrams?: number;
  quantity?: number; // old compat
  sellPrice?: number;
  pricePerKg?: number;
  buyPrice?: number;
  buyPriceAvg?: number;
  buyPricePerKg?: number;
  customerName?: string;
  paymentType?: "cash" | "credit";
};

function isValidObjectId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const sale = await Sale.findOne({ _id: id, userId: new Types.ObjectId(session.user.id) }).lean();
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    return NextResponse.json(sale);
  } catch {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const body = (await req.json()) as SaleUpdateBody;

    const sale = await Sale.findOne({ _id: id, userId });
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    const oldWeight = rnd(sale.weightGrams || (sale.quantity ? sale.quantity * 1000 : 0) || 0);
    const oldTotal = rnd(sale.total);
    const newWeight = body.weightGrams !== undefined ? rnd(body.weightGrams) : body.quantity !== undefined ? rnd(body.quantity * 1000) : oldWeight;
    const newPricePerKg = body.pricePerKg !== undefined ? rnd(body.pricePerKg) : body.sellPrice !== undefined ? rnd(body.sellPrice) : rnd(sale.pricePerKg || sale.sellPrice || 0);
    const buy = rnd(body.buyPricePerKg ?? body.buyPriceAvg ?? body.buyPrice ?? sale.buyPricePerKg ?? sale.buyPriceAvg ?? 0);

    if (newWeight <= 0) return NextResponse.json({ error: "Weight must be > 0" }, { status: 400 });

    const diffGrams = rnd(newWeight - oldWeight);

    // Restore/check stock for loose items like Kajoor/Kishmish
    if (sale.saleType === "loose" || sale.productId) {
      const product = await Product.findOne({ _id: sale.productId, userId });
      if (product) {
        if (product.stockMode === "limited" && diffGrams > 0 && product.stockInGrams < diffGrams) {
          return NextResponse.json({ error: `Only ${product.stockInGrams}g left, need ${diffGrams}g more for ${product.name}` }, { status: 400 });
        }
        if (product.stockMode === "limited" && diffGrams !== 0) {
          product.stockInGrams = rnd(product.stockInGrams - diffGrams);
          await product.save();
        }
      }
    }

    // For mix Salan Masala - adjust raw items
    if (sale.saleType === "mix" && sale.mixId) {
      const mix = await MixMasala.findOne({ _id: sale.mixId, userId });
      if (mix) {
        for (const item of mix.recipe) {
          const oldNeeded = rnd((item.gramsPerKg * oldWeight) / 1000);
          const newNeeded = rnd((item.gramsPerKg * newWeight) / 1000);
          const diffNeeded = rnd(newNeeded - oldNeeded);
          const rawProduct = await Product.findOne({ _id: item.productId, userId });
          if (rawProduct && rawProduct.stockMode === "limited") {
            if (diffNeeded > 0 && rawProduct.stockInGrams < diffNeeded) {
              return NextResponse.json({ error: `Low ${rawProduct.name} stock for ${mix.name}` }, { status: 400 });
            }
            rawProduct.stockInGrams = rnd(rawProduct.stockInGrams - diffNeeded);
            await rawProduct.save();
          }
        }
      }
    }

    const weightKg = newWeight / 1000;
    const newTotal = rnd(newPricePerKg * weightKg);
    const newProfit = rnd((newPricePerKg - buy) * weightKg);
    const totalDiff = rnd(newTotal - oldTotal);

    sale.weightGrams = newWeight;
    sale.quantity = weightKg;
    sale.pricePerKg = newPricePerKg;
    sale.sellPrice = newPricePerKg;
    sale.buyPricePerKg = buy;
    sale.buyPriceAvg = buy;
    sale.buyPrice = buy;
    sale.total = newTotal;
    sale.profit = newProfit;
    if (body.customerName) sale.customerName = body.customerName.trim();
    if (body.paymentType) {
      sale.paymentType = body.paymentType;
      sale.status = body.paymentType === "credit" ? "pending" : "paid";
    }
    await sale.save();

    if (sale.paymentType === "credit" || sale.status === "pending") {
      if (totalDiff !== 0) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $inc: { totalUdhar: totalDiff, totalBusiness: totalDiff }, $set: { lastUdharDate: new Date() } }
        );
      }
      if (body.customerName) {
        await Customer.findOneAndUpdate(
          { userId, saleIds: sale._id, isPaid: false },
          { $set: { name: body.customerName.trim(), normalizedName: body.customerName.trim().toLowerCase() } }
        );
      }
    }

    return NextResponse.json(sale);
  } catch {
    return NextResponse.json({ error: "Failed to update sale" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);

    let saleDoc = null;
    if (isValidObjectId(id)) {
      saleDoc = await Sale.findOne({ _id: id, userId });
    }
    if (!saleDoc) {
      saleDoc = await Sale.findOne({ localId: id, userId });
    }
    if (!saleDoc) return NextResponse.json({ error: "Sale not found" }, { status: 404 });

    // Restore stock - loose
    if (saleDoc.saleType === "loose" || saleDoc.productId) {
      const product = await Product.findOne({ _id: saleDoc.productId, userId });
      if (product && product.stockMode === "limited") {
        const restore = rnd(saleDoc.weightGrams || (saleDoc.quantity ? saleDoc.quantity * 1000 : 0) || 0);
        product.stockInGrams = rnd(product.stockInGrams + restore);
        await product.save();
      }
    }

    // Restore raw items for mix masala
    if (saleDoc.saleType === "mix" && saleDoc.mixId) {
      const mix = await MixMasala.findOne({ _id: saleDoc.mixId, userId });
      if (mix) {
        for (const item of mix.recipe) {
          const restore = rnd((item.gramsPerKg * (saleDoc.weightGrams || 0)) / 1000);
          const rawProduct = await Product.findOne({ _id: item.productId, userId });
          if (rawProduct && rawProduct.stockMode === "limited") {
            rawProduct.stockInGrams = rnd(rawProduct.stockInGrams + restore);
            await rawProduct.save();
          }
        }
      }
    }

    if (saleDoc.paymentType === "credit" || saleDoc.status === "pending") {
      const updated = await Customer.findOneAndUpdate(
        { userId, saleIds: saleDoc._id, isPaid: false },
        { $inc: { totalUdhar: -saleDoc.total, totalBusiness: -saleDoc.total, billsCount: -1 }, $pull: { saleIds: saleDoc._id } },
        { new: true }
      );
      if (updated && (updated.totalUdhar <= 0 || updated.billsCount <= 0)) {
        await Customer.deleteOne({ _id: updated._id });
      }
    }

    await Sale.deleteOne({ _id: saleDoc._id, userId });
    return NextResponse.json({ success: true, message: "Sale deleted, stock restored", restored: saleDoc.weightGrams });
  } catch {
    return NextResponse.json({ error: "Failed to delete sale" }, { status: 500 });
  }
}