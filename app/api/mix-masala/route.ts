import dbConnect from "@/lib/mongodb";
import MixMasala from "@/models/MixMasala";
import Product from "@/models/Product";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MixMasalaBody = {
  name: string;
  pricePerKg: number;
  recipe: { productId: string; gramsPerKg: number }[];
  localId?: string;
};

type MongoError = { code?: number };

function rnd(n: number): number {
  return Math.round(Number(n) || 0);
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ mixMasala: [] }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const list = await MixMasala.find({ userId }).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ mixMasala: list });
  } catch {
    return NextResponse.json({ mixMasala: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const body = (await req.json()) as MixMasalaBody;

    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (!body.recipe?.length) return NextResponse.json({ error: "Recipe required" }, { status: 400 });

    const totalGrams = body.recipe.reduce((s, r) => s + rnd(r.gramsPerKg), 0);
    if (totalGrams !== 1000) return NextResponse.json({ error: `Recipe must total 1000g per kg, got ${totalGrams}g` }, { status: 400 });

    let buyCost = 0;
    const finalRecipe: { productId: Types.ObjectId; productName: string; gramsPerKg: number }[] = [];
    for (const r of body.recipe) {
      if (!Types.ObjectId.isValid(r.productId)) return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
      const prod = await Product.findOne({ _id: r.productId, userId }).lean();
      if (!prod) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      const grams = rnd(r.gramsPerKg);
      finalRecipe.push({ productId: new Types.ObjectId(r.productId), productName: prod.name, gramsPerKg: grams });
      buyCost += (prod.buyPricePerKg || 0) * (grams / 1000);
    }

    if (body.localId) {
      const exists = await MixMasala.findOne({ localId: body.localId, userId }).lean();
      if (exists) return NextResponse.json(exists, { status: 200 });
    }

    const created = await MixMasala.create({
      name: body.name.trim(),
      pricePerKg: rnd(body.pricePerKg),
      buyPricePerKg: rnd(buyCost),
      recipe: finalRecipe,
      userId,
      localId: body.localId || `mix_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    const err = e as MongoError;
    if (err.code === 11000) return NextResponse.json({ error: "Mix masala name already exists" }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}