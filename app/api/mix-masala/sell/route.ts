import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import MixMasala from "@/models/MixMasala";
import Product from "@/models/Product";
import Sale from "@/models/Sale";

interface SellBody {
  mixId: string;
  grams: number;
}

interface RecipeItem {
  productId: { _id?: string } | string;
  gramsPerKg: number;
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const body = (await req.json()) as SellBody;
    const { mixId, grams } = body;

    if (!mixId || !grams || grams <= 0) {
      return NextResponse.json({ error: "mixId and grams required" }, { status: 400 });
    }

    const mix = await MixMasala.findById(mixId);
    if (!mix) {
      return NextResponse.json({ error: "Mix not found" }, { status: 404 });
    }

    const sellGrams = Number(grams);
    const totalPrice = Math.round((mix.pricePerKg / 1000) * sellGrams);
    const totalBuy = Math.round((mix.buyPricePerKg / 1000) * sellGrams);

    const recipe = mix.recipe as unknown as RecipeItem[];

    for (const item of recipe) {
      const rawId =
        typeof item.productId === "string"
          ? item.productId
          : item.productId._id || "";

      if (!rawId) continue;

      const deductGrams = (item.gramsPerKg / 1000) * sellGrams;
      const prod = await Product.findById(rawId);
      if (!prod) continue;

      const currentStock = prod.stockInGrams || 0;
      if (currentStock < deductGrams) {
        return NextResponse.json(
          { error: `Low stock for ${prod.name}: have ${currentStock}g, need ${Math.round(deductGrams)}g` },
          { status: 400 }
        );
      }

      prod.stockInGrams = currentStock - deductGrams;
      await prod.save();
    }

    try {
      await Sale.create({
        items: [{ name: `${mix.name} ${sellGrams}g`, qty: 1, price: totalPrice }],
        total: totalPrice,
        profit: totalPrice - totalBuy,
        cost: totalBuy,
        mixMasalaId: mix._id,
        grams: sellGrams,
        type: "mix-masala",
      });
    } catch (err) {
      console.warn("Sale create skipped (model may not exist):", err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      success: true,
      total: totalPrice,
      buy: totalBuy,
      profit: totalPrice - totalBuy,
      grams: sellGrams,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("Sell mix error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}