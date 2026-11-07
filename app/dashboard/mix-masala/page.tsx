"use client";
/* eslint-disable react-hooks/purity */

import { useEffect, useState, useCallback } from "react";

type Product = { _id: string; name: string; buyPricePerKg: number; pricePerKg: number; stockInGrams: number };
type MixRecipeItem = { productId: string; productName: string; gramsPerKg: number };
type MixMasala = { _id: string; name: string; pricePerKg: number; buyPricePerKg: number; recipe: MixRecipeItem[] };
type RecipeInput = { productId: string; gramsPerKg: number };

export default function MixMasalaPage() {
  const [mixList, setMixList] = useState<MixMasala[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Salan Masala 350g");
  const [pricePerKg, setPricePerKg] = useState<number>(800);
  const [recipe, setRecipe] = useState<RecipeInput[]>([
    { productId: "", gramsPerKg: 200 },
    { productId: "", gramsPerKg: 50 },
    { productId: "", gramsPerKg: 50 },
    { productId: "", gramsPerKg: 50 },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sellGrams, setSellGrams] = useState<number>(350);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [mixRes, prodRes] = await Promise.all([fetch("/api/mix-masala"), fetch("/api/products")]);
      const mixData = (await mixRes.json()) as { mixMasala: MixMasala[] };
      const prodData = (await prodRes.json()) as { products: Product[] } | Product[];
      setMixList(mixData.mixMasala || []);
      setProducts(Array.isArray(prodData) ? prodData : prodData.products || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const totalGrams = recipe.reduce((s, r) => s + (Number(r.gramsPerKg) || 0), 0);
  const buyCostPerKg = recipe.reduce((s, r) => {
    const prod = products.find((p) => p._id === r.productId);
    return s + (prod?.buyPricePerKg || 0) * ((Number(r.gramsPerKg) || 0) / 1000);
  }, 0);
  const buyCostForCurrentTotal = recipe.reduce((s, r) => {
    const prod = products.find((p) => p._id === r.productId);
    return s + (prod?.buyPricePerKg || 0) * ((Number(r.gramsPerKg) || 0) / 1000);
  }, 0);

  const sellForCustom = (pricePerKg / 1000) * sellGrams;
  const buyForCustom = (buyCostPerKg / 1000) * sellGrams;
  const profitForCustom = sellForCustom - buyForCustom;
  const profitPerKg = pricePerKg - buyCostPerKg;
  const sellForSpecialDirect = (pricePerKg / 1000) * totalGrams;
  const profitForSpecialDirect = sellForSpecialDirect - buyCostForCurrentTotal;

  const resetForm = useCallback(() => {
    setName("Salan Masala 350g");
    setPricePerKg(800);
    setRecipe([
      { productId: "", gramsPerKg: 150 },
      { productId: "", gramsPerKg: 50 },
      { productId: "", gramsPerKg: 50 },
      { productId: "", gramsPerKg: 100 },
    ]);
    setEditingId(null);
  }, []);

  const fillPreset = useCallback(
    (type: "salan" | "garam") => {
      const findId = (n: string) => products.find((p) => p.name.toLowerCase().includes(n))?._id || "";
      if (type === "salan") {
        setName("Salan Masala");
        setPricePerKg(800);
        setRecipe([
          { productId: findId("dhania"), gramsPerKg: 450 },
          { productId: findId("zeera"), gramsPerKg: 150 },
          { productId: findId("haldi"), gramsPerKg: 150 },
          { productId: findId("mirch"), gramsPerKg: 250 },
        ]);
      } else {
        setName("Garam Masala");
        setPricePerKg(1400);
        setRecipe([
          { productId: findId("darchini"), gramsPerKg: 200 },
          { productId: findId("laung"), gramsPerKg: 150 },
          { productId: findId("kali"), gramsPerKg: 200 },
          { productId: findId("zeera"), gramsPerKg: 200 },
          { productId: findId("dhania"), gramsPerKg: 250 },
        ]);
      }
    },
    [products]
  );

  const handleSave = async () => {
    if (!name.trim()) return alert("Name required");
    if (totalGrams !== 1000) return alert(`Recipe must be 1000g for factory, now ${totalGrams}g. For special use SPECIAL sell button.`);
    if (recipe.some((r) => !r.productId)) return alert("Select all raw products");
    const payload = { name: name.trim(), pricePerKg: Math.round(pricePerKg), recipe };
    const url = editingId ? `/api/mix-masala/${editingId}` : "/api/mix-masala";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) return alert(data.error || "Failed");
    await fetchData();
    resetForm();
  };

  const handleSellMix = async (mix: MixMasala) => {
    const input = prompt(`Customer wants how many grams of ${mix.name}?`, String(sellGrams));
    const grams = Number(input || sellGrams);
    if (!grams || grams <= 0) return;
    const totalForGrams = Math.round((mix.pricePerKg / 1000) * grams);
    if (!confirm(`Sell ${grams}g ${mix.name} for ${totalForGrams} Rs? Stock will deduct.`)) return;
    const localId = `mix_${mix._id}_${Date.now()}`;
    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mixId: mix._id,
        weightGrams: grams,
        pricePerKg: mix.pricePerKg,
        buyPricePerKg: mix.buyPricePerKg,
        category: "masala_mix",
        saleType: "mix",
        paymentType: "cash",
        customerName: "Walk-in",
        localId,
      }),
    });
    const d = (await res.json()) as { error?: string; total?: number };
    if (!res.ok) return alert(d.error || "Sell failed");
    alert(`Sold ${grams}g ${mix.name} - ${d.total} Rs`);
    await fetchData();
  };

  const handleSpecialSell = async () => {
    if (totalGrams <= 0) return alert("Add grams for special customer");
    if (recipe.some((r) => !r.productId)) return alert("Select raw product for each row");
    const confirmMsg = `SPECIAL CUSTOMER\n${name} - ${totalGrams}g\nSell: ${Math.round(sellForSpecialDirect)} Rs | Buy: ${Math.round(buyCostForCurrentTotal)} Rs | Profit: ${Math.round(profitForSpecialDirect)} Rs\n\nDeduct stock exactly?`;
    if (!confirm(confirmMsg)) return;

    const localId = `special_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: `${name} ${totalGrams}g (Special)`,
        weightGrams: totalGrams,
        pricePerKg: Math.round((sellForSpecialDirect / totalGrams) * 1000) || pricePerKg,
        buyPricePerKg: Math.round((buyCostForCurrentTotal / totalGrams) * 1000),
        category: "masala_mix",
        saleType: "mix",
        paymentType: "cash",
        customerName: "Special Customer",
        localId,
        customRecipe: recipe,
      }),
    });
    const d = (await res.json()) as { error?: string };
    if (!res.ok) return alert(d.error || "Sale failed");

    for (const r of recipe) {
      await fetch("/api/products/deduct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: r.productId, grams: r.gramsPerKg }),
      });
    }
    alert(`Sold SPECIAL ${totalGrams}g for ${Math.round(sellForSpecialDirect)} Rs`);
    await fetchData();
  };

  const handleEdit = useCallback((mix: MixMasala) => {
    setEditingId(mix._id);
    setName(mix.name);
    setPricePerKg(mix.pricePerKg);
    setRecipe(
      mix.recipe.map((r) => ({
        productId: (r.productId as unknown as { _id?: string })?._id || (r.productId as unknown as string),
        gramsPerKg: r.gramsPerKg,
      }))
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mix masala?")) return;
    const res = await fetch(`/api/mix-masala/${id}`, { method: "DELETE" });
    if (!res.ok) return alert("Failed to delete");
    await fetchData();
  };

  if (loading) return <div className="p-3 text-[11px]">Loading Masala...</div>;

  return (
    <div className="min-h-dvh bg-gray-50">
      <div className="max-w-120 md:max-w-6xl mx-auto px-2.5 md:px-6 py-2.5 md:py-6 space-y-3">
        <h1 className="text-[13px] md:text-[20px] font-bold leading-tight">Shahsawar Mix Masala - Salan / Garam - Shewa</h1>

        <div className="bg-white p-2.5 md:p-4 rounded-xl shadow-sm border space-y-2.5">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button onClick={() => fillPreset("salan")} className="shrink-0 text-[10px] leading-tight bg-amber-100 border border-amber-200 px-2.5 py-2 rounded-lg font-bold text-left">Salan Preset<br/>(1000g)</button>
            <button onClick={() => fillPreset("garam")} className="shrink-0 text-[10px] leading-tight bg-zinc-50 border px-2.5 py-2 rounded-lg font-bold text-left">Garam Preset<br/>(1000g)</button>
            <button onClick={() => { setRecipe([{ productId: products[0]?._id || "", gramsPerKg: 200 },{ productId: products[1]?._id || "", gramsPerKg: 50 },{ productId: products[2]?._id || "", gramsPerKg: 50 },{ productId: products[3]?._id || "", gramsPerKg: 50 }]); setName("Special Salan 350g"); }} className="shrink-0 text-[10px] leading-tight bg-blue-50 border border-blue-200 px-2.5 py-2 rounded-lg font-bold text-left">Special 350g<br/>(Dhania 200g)</button>
          </div>

          <h2 className="text-[11px] md:text-[13px] font-bold">{editingId ? "Edit Mix (1000g Factory)" : "Create New Mix - 2 Modes Below"}</h2>
          
          <div className="grid grid-cols-1 gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full border p-2 rounded-lg text-[11px] md:text-[13px] outline-none focus:border-black" />
            <input type="number" value={pricePerKg || ""} onChange={(e) => setPricePerKg(Number(e.target.value))} placeholder="Sell Price per Kg" className="w-full border p-2 rounded-lg text-[11px] md:text-[13px] outline-none" />
          </div>

          <div className="space-y-1.5">
            {recipe.map((r, idx) => (
              <div key={idx} className="flex gap-1 items-center">
                <select
                  value={r.productId}
                  onChange={(e) => {
                    const copy = [...recipe];
                    copy[idx].productId = e.target.value;
                    setRecipe(copy);
                  }}
                  className="flex-1 min-w-0 border p-2 rounded-lg text-[10px] md:text-[12px] bg-white outline-none"
                >
                  <option value="">Select Raw Product</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>{p.name} - {p.buyPricePerKg}/kg ({p.stockInGrams}g)</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={r.gramsPerKg || ""}
                  onChange={(e) => {
                    const copy = [...recipe];
                    copy[idx].gramsPerKg = Number(e.target.value);
                    setRecipe(copy);
                  }}
                  className="w-13 border p-2 rounded-lg text-[10px] font-bold text-center outline-none"
                />
                <button onClick={() => setRecipe(recipe.filter((_, i) => i !== idx))} className="w-6 h-8 flex items-center justify-center bg-red-50 text-red-500 rounded-lg text-[11px]">x</button>
              </div>
            ))}
            <button onClick={() => setRecipe([...recipe, { productId: "", gramsPerKg: 0 }])} className="text-[11px] text-blue-600 font-bold">+ Add Ingredient</button>
          </div>

          <div className="text-[10px] bg-amber-50 p-2.5 rounded-lg border border-amber-100 space-y-1 leading-tight">
            <div>Total: <b>{totalGrams}g {totalGrams === 1000 ? "Factory OK" : "Adjust to 1000g"}</b></div>
            <div>Cost: {Math.round(buyCostForCurrentTotal)} Rs | Sell: {Math.round(totalGrams===1000 ? pricePerKg : sellForSpecialDirect)} Rs | Profit: <b className="text-green-700">{Math.round(totalGrams===1000 ? profitPerKg : profitForSpecialDirect)} Rs</b></div>
            <div className="flex gap-1.5 items-center pt-1.5 border-t border-amber-200 mt-1 flex-wrap">
              <span>Preview:</span>
              <input type="number" value={sellGrams} onChange={(e) => setSellGrams(Number(e.target.value))} className="w-14 border p-1 rounded text-center font-bold text-[10px]" />
              <span>g = <b>{Math.round(sellForCustom)} Rs</b></span>
            </div>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => void handleSave()} className="flex-1 bg-black text-white px-3 py-2.5 rounded-lg font-bold text-[11px]">Create Mix (1000g)</button>
            <button onClick={() => void handleSpecialSell()} className="flex-1 bg-[#b45309] text-white px-3 py-2.5 rounded-lg font-bold text-[11px]">Sell SPECIAL {totalGrams}g - {Math.round(sellForSpecialDirect)} Rs</button>
            {editingId && <button onClick={resetForm} className="px-3 py-2 border rounded-lg text-[11px]">Cancel</button>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-6">
          {mixList.map((mix) => {
            const customSell = (mix.pricePerKg / 1000) * sellGrams;
            return (
              <div key={mix._id} className="bg-white p-2.5 rounded-xl shadow-sm border">
                <div className="flex justify-between items-start gap-2">
                  <h3 className="font-bold text-[12px] leading-tight">{mix.name}</h3>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleEdit(mix)} className="text-[9px] px-2 py-1 bg-yellow-100 rounded">Edit</button>
                    <button onClick={() => void handleDelete(mix._id)} className="text-[9px] px-2 py-1 bg-red-100 rounded">Del</button>
                  </div>
                </div>
                <div className="text-[10px] mt-1.5">Sell: {mix.pricePerKg} Rs/kg | Buy: {Math.round(mix.buyPricePerKg)} Rs</div>
                <ul className="text-[9px] mt-1.5 list-disc ml-3 space-y-0 leading-tight">
                  {mix.recipe.map((r, i) => (
                    <li key={i}>{r.productName} - {r.gramsPerKg}g/kg</li>
                  ))}
                </ul>
                <button onClick={() => void handleSellMix(mix)} className="mt-2 w-full bg-black text-white py-2 rounded-lg font-bold text-[11px]">Sell {sellGrams}g - {Math.round(customSell)} Rs</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}