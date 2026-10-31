import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Types } from "mongoose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type ProductUpdateBody = {
  name?: string;
  category?: "dryfruit" | "pansar" | "masala_raw" | "masala_mix";
  pricePerKg?: number;
  buyPricePerKg?: number;
  stockInGrams?: number;
  stockMode?: "limited" | "unlimited";
};

type ProductUpdateData = {
  lastSyncedAt: Date;
  synced: boolean;
  name?: string;
  category?: string;
  pricePerKg?: number;
  buyPricePerKg?: number;
  stockInGrams?: number;
  stockMode?: string;
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
    const userId = new Types.ObjectId(session.user.id);
    const product = await Product.findOne({ _id: id, userId }).lean({ virtuals: true });
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json(product);
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
    const body = (await req.json()) as ProductUpdateBody;

    const updateData: ProductUpdateData = { lastSyncedAt: new Date(), synced: true };
    if (body.name?.trim()) updateData.name = body.name.trim();
    if (body.category) updateData.category = body.category;
    if (body.pricePerKg !== undefined) updateData.pricePerKg = rnd(body.pricePerKg);
    if (body.buyPricePerKg !== undefined) updateData.buyPricePerKg = rnd(body.buyPricePerKg);
    if (body.stockInGrams !== undefined) updateData.stockInGrams = rnd(body.stockInGrams);
    if (body.stockMode) updateData.stockMode = body.stockMode;

    const updated = await Product.findOneAndUpdate(
      { _id: id, userId },
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean({ virtuals: true });

    if (!updated) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  if (!isValidObjectId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await dbConnect();
    const userId = new Types.ObjectId(session.user.id);
    const deleted = await Product.findOneAndDelete({ _id: id, userId });
    if (!deleted) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json({ message: "Product deleted", deletedId: id });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}