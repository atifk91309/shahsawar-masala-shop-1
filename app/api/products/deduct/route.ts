import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Product from "@/models/Product";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if(!session?.user?.id) return NextResponse.json({error:"Unauthorized"},{status:401});
  await dbConnect();
  const { productId, grams } = await req.json() as { productId: string; grams: number };
  const p = await Product.findOne({_id: productId, userId: session.user.id});
  if(!p) return NextResponse.json({error:"Product not found"},{status:404});
  if(p.stockMode==="limited"){
    p.stockInGrams = Math.max(0, (p.stockInGrams||0) - Math.round(grams));
    await p.save();
  }
  return NextResponse.json({success:true, stock: p.stockInGrams});
}