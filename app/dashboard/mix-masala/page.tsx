"use client";

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

  // For Special top form (direct grams = customer order)
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
    if (totalGrams !== 1000) return alert(`Recipe must be 1000g total for factory, now ${totalGrams}g. For special customer use SPECIAL sell button below.`);
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
        localId: `mix_${mix._id}_${Date.now()}`,
      }),
    });
    const d = (await res.json()) as { error?: string; total?: number };
    if (!res.ok) return alert(d.error || "Sell failed - " + d.error);
    alert(`✅ Sold ${grams}g ${mix.name} - ${d.total} Rs | Check Sales History`);
    await fetchData();
  };

  const handleSpecialSell = async () => {
    if (totalGrams <= 0) return alert("Add grams for special customer");
    if (recipe.some((r) => !r.productId)) return alert("Select raw product for each row");
    const confirmMsg = `SPECIAL CUSTOMER\n${name} - ${totalGrams}g\nDhania etc custom: ${recipe.map(r => {
      const p = products.find(x=>x._id===r.productId);
      return `${p?.name || 'Item'} ${r.gramsPerKg}g`;
    }).join(", ")}\n\nSell: ${Math.round(sellForSpecialDirect)} Rs | Buy: ${Math.round(buyCostForCurrentTotal)} Rs | Profit: ${Math.round(profitForSpecialDirect)} Rs\n\nDeduct stock exactly?`;
    if (!confirm(confirmMsg)) return;

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
        localId: `special_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, // eslint-disable-line react-hooks/purity
        customRecipe: recipe, // your /api/sales will ignore, but we deduct below
      }),
    });
    const d = (await res.json()) as { error?: string };
    if (!res.ok) return alert(d.error || "Sale failed");

    // Deduct raw stock exactly as typed (200g Dhania etc)
    for (const r of recipe) {
      await fetch("/api/products/deduct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: r.productId, grams: r.gramsPerKg }),
      });
    }

    alert(`✅ Sold SPECIAL ${totalGrams}g for ${Math.round(sellForSpecialDirect)} Rs`);
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

  if (loading) return <div className="p-6">Loading Masala...</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">🌶️ Shahsawar Mix Masala - Salan / Garam - Ismaila</h1>

      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow space-y-3 border">
        <div className="flex gap-2">
          <button onClick={() => fillPreset("salan")} className="text-[11px] bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg font-bold">🥘 Salan Preset (1000g)</button>
          <button onClick={() => fillPreset("garam")} className="text-[11px] bg-zinc-100 border px-3 py-1.5 rounded-lg font-bold">🍛 Garam Preset (1000g)</button>
          <button onClick={() => { setRecipe([{ productId: products[0]?._id || "", gramsPerKg: 200 },{ productId: products[1]?._id || "", gramsPerKg: 50 },{ productId: products[2]?._id || "", gramsPerKg: 50 },{ productId: products[3]?._id || "", gramsPerKg: 50 }]); setName("Special Salan 350g"); }} className="text-[11px] bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg font-bold">⭐ Special 350g (Dhania 200g)</button>
        </div>

        <h2 className="font-semibold">{editingId ? "Edit Mix (1000g Factory)" : "Create New Mix - 2 Modes Below"}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name - e.g. Salan Masala" className="border p-2.5 rounded-lg text-[13px]" />
          <input type="number" value={pricePerKg || ""} onChange={(e) => setPricePerKg(Number(e.target.value))} placeholder="Sell Price per Kg" className="border p-2.5 rounded-lg text-[13px]" />
        </div>

        <div className="space-y-2">
          {recipe.map((r, idx) => (
            <div key={idx} className="flex gap-2">
              <select
                value={r.productId}
                onChange={(e) => {
                  const copy = [...recipe];
                  copy[idx].productId = e.target.value;
                  setRecipe(copy);
                }}
                className="border p-2.5 rounded-lg flex-1 text-[13px]"
              >
                <option value="">Select Raw Product</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>{p.name} - Buy {p.buyPricePerKg}/kg (Stock {p.stockInGrams}g)</option>
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
                placeholder="g"
                className="border p-2 rounded w-28 text-[13px] font-bold"
              />
              <button onClick={() => setRecipe(recipe.filter((_, i) => i !== idx))} className="px-2.5 bg-red-50 text-red-600 rounded text-[12px]">X</button>
            </div>
          ))}
          <button onClick={() => setRecipe([...recipe, { productId: "", gramsPerKg: 0 }])} className="text-sm text-blue-600 font-bold">+ Add Ingredient</button>
        </div>

        <div className="text-[12px] space-y-1 bg-amber-50 p-3 rounded-xl border border-amber-100">
          <div>Recipe Total: <b>{totalGrams}g {totalGrams === 1000 ? "/ 1000g ✅ Factory" : totalGrams === 350 || totalGrams === 200 || totalGrams === 100 ? `/ ${totalGrams}g ⭐ Special Customer` : "/ 1000g ❌ Adjust"}</b></div>
          <div>Cost: {Math.round(buyCostForCurrentTotal)} Rs for {totalGrams}g ({Math.round(buyCostPerKg)} Rs/kg) | Sell: {Math.round(totalGrams===1000 ? pricePerKg : sellForSpecialDirect)} Rs for {totalGrams}g | Profit: <span className="text-green-700 font-bold">{Math.round(totalGrams===1000 ? profitPerKg : profitForSpecialDirect)} Rs</span></div>
          <div className="pt-2 border-t border-amber-200 mt-2 flex gap-2 items-center flex-wrap">
            <span>Factory sell preview:</span>
            <input type="number" value={sellGrams} onChange={(e) => setSellGrams(Number(e.target.value))} className="w-20 border p-1.5 rounded-lg text-center font-bold" />
            <span>g = Sell <b>{Math.round(sellForCustom)} Rs</b> | Profit <b className="text-green-700">{Math.round(profitForCustom)} Rs</b></span>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => void handleSave()} className="bg-black text-white px-6 py-2.5 rounded-xl font-bold text-[13px]">Create Mix (needs 1000g)</button>
          <button onClick={() => void handleSpecialSell()} className="bg-[#b45309] text-white px-6 py-2.5 rounded-xl font-bold text-[13px]">⭐ Sell SPECIAL {totalGrams}g - {Math.round(sellForSpecialDirect)} Rs (Dhania change)</button>
          {editingId && <button onClick={resetForm} className="px-4 py-2 border rounded-xl text-[13px]">Cancel</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mixList.map((mix) => {
          const customSell = (mix.pricePerKg / 1000) * sellGrams;
          return (
            <div key={mix._id} className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow border">
              <div className="flex justify-between items-start">
                <h3 className="font-bold">{mix.name}</h3>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(mix)} className="text-[11px] px-2.5 py-1 bg-yellow-100 rounded-lg">Edit</button>
                  <button onClick={() => void handleDelete(mix._id)} className="text-[11px] px-2.5 py-1 bg-red-100 rounded-lg">Delete</button>
                </div>
              </div>
              <div className="text-[12px] mt-2">Sell: {mix.pricePerKg} Rs/kg | Buy: {Math.round(mix.buyPricePerKg)} Rs</div>
              <div className="text-[12px] mt-1 bg-gray-50 p-2 rounded-lg">For {sellGrams}g: <b>{Math.round(customSell)} Rs</b></div>
              <ul className="text-[11px] mt-2 list-disc ml-4 space-y-0.5">
                {mix.recipe.map((r, i) => (
                  <li key={i}>{r.productName} - {r.gramsPerKg}g per kg ({Math.round((r.gramsPerKg / 1000) * sellGrams)}g for {sellGrams}g)</li>
                ))}
              </ul>
              <button onClick={() => void handleSellMix(mix)} className="mt-3 w-full bg-black text-white py-2.5 rounded-xl font-bold text-[12px]">🛒 Sell {sellGrams}g - {Math.round(customSell)} Rs</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}