import dbConnect from "@/lib/mongodb";
import MixMasala from "@/models/MixMasala";
import Product from "@/models/Product";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type UpdateBody = {
  name?: string;
  pricePerKg?: number;
  recipe?: { productId: string; gramsPerKg: number }[];
};

type MongoError = { code?: number };
type RecipeItem = { productId: Types.ObjectId; productName: string; gramsPerKg: number };

function rnd(n: number): number { return Math.round(Number(n) || 0); }
function isValidObjectId(id: string): boolean { return Types.ObjectId.isValid(id); }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const item = await MixMasala.findOne({ _id: id, userId: new Types.ObjectId(session.user.id) }).lean();
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const body = (await req.json()) as UpdateBody;

    const existing = await MixMasala.findOne({ _id: id, userId });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (body.name?.trim()) existing.name = body.name.trim();
    if (body.pricePerKg !== undefined) existing.pricePerKg = rnd(body.pricePerKg);

    if (body.recipe?.length) {
      const totalGrams = body.recipe.reduce((s, r) => s + rnd(r.gramsPerKg), 0);
      if (totalGrams !== 1000) return NextResponse.json({ error: `Recipe must total 1000g, got ${totalGrams}g` }, { status: 400 });

      let buyCost = 0;
      const finalRecipe: RecipeItem[] = [];
      for (const r of body.recipe) {
        if (!Types.ObjectId.isValid(r.productId)) return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
        const prod = await Product.findOne({ _id: r.productId, userId }).lean();
        if (!prod) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        const grams = rnd(r.gramsPerKg);
        finalRecipe.push({ productId: new Types.ObjectId(r.productId), productName: prod.name, gramsPerKg: grams });
        buyCost += (prod.buyPricePerKg || 0) * (grams / 1000);
      }
      existing.recipe = finalRecipe as unknown as typeof existing.recipe;
      existing.buyPricePerKg = rnd(buyCost);
    }

    await existing.save();
    return NextResponse.json(existing);
  } catch (e) {
    const err = e as MongoError;
    if (err.code === 11000) return NextResponse.json({ error: "Name already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to update" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const deleted = await MixMasala.findOneAndDelete({ _id: id, userId });
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ message: "Deleted", deletedId: id });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}