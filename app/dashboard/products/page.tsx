"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { offlineDB } from "@/lib/offline-db";
import type { OfflineProduct, SaleCategory } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type Product = {
  _id: string;
  name: string;
  category: SaleCategory;
  buyPricePerKg: number;
  pricePerKg: number;
  stockInGrams: number;
  localId?: string;
  synced?: number;
};
type FormState = { name: string; category: SaleCategory; buyPricePerKg: string; pricePerKg: string; stockInGrams: string; };
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type ProductsResponse = { products: Product[]; pagination: Pagination } | Product[];
type OfflineUser = { _id?: string } | null;

function generateLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `local_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function useIsOnline(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  }, []);
  const getSnapshot = useCallback(() => window.navigator.onLine, []);
  const getServerSnapshot = useCallback(() => true, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
function rnd(n: number) { return Math.round(n || 0); }
function toProductCategory(c: string | undefined): SaleCategory {
  if (c === "dryfruit" || c === "pansar" || c === "masala_raw" || c === "masala_mix" || c === "other") return c;
  return "other";
}
function gramsToKgG(g: number) {
  const kg = Math.floor(g / 1000);
  const gram = g % 1000;
  if (kg > 0) return `${kg}kg ${gram}g`;
  return `${gram}g`;
}

export default function ProductsPage() {
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<FormState>({ name: "", category: "dryfruit", buyPricePerKg: "", pricePerKg: "", stockInGrams: "1000" });
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, hasMore: false, totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshAfterAction = useCallback(async (currentSearch: string, cat: string) => {
    setPage(1);
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      const cached = await offlineDB.products.toArray();
      const searchLower = currentSearch.toLowerCase();
      const filtered = cached.filter((c) => {
        const matchSearch = !currentSearch || c.name.toLowerCase().includes(searchLower);
        const matchCat = cat === "all" || c.category === cat;
        return matchSearch && matchCat;
      });
      const limit = 20;
      const paged = filtered.slice(0, limit).map((c): Product => ({
        _id: c._id || c.localId,
        name: c.name,
        category: toProductCategory(c.category),
        buyPricePerKg: c.buyPricePerKg || 0,
        pricePerKg: c.pricePerKg || 0,
        stockInGrams: c.stockInGrams ?? 0,
        localId: c.localId,
        synced: c.synced,
      }));
      setProducts(paged);
      setPagination({ page: 1, totalPages: Math.ceil(filtered.length / 20) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length });
      return;
    }
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(currentSearch)}&category=${cat}&page=1&limit=20`);
      const data = (await res.json()) as ProductsResponse;
      let list: Product[] = [];
      if (Array.isArray(data)) {
        list = data as Product[];
        setProducts(list);
        setPagination({ page: 1, totalPages: 1, hasMore: false, totalCount: data.length });
      } else {
        list = data.products;
        setProducts(data.products);
        setPagination(data.pagination);
      }
      if (list.length > 0) {
        const offlineUser = getOfflineUser() as OfflineUser;
        const userId = offlineUser?._id || "offline";
        const toCache: OfflineProduct[] = list.map((p) => ({
          _id: p._id,
          localId: p.localId || p._id,
          name: p.name,
          category: p.category,
          buyPricePerKg: p.buyPricePerKg,
          pricePerKg: p.pricePerKg,
          stockInGrams: p.stockInGrams,
          buyPriceAvg: p.buyPricePerKg,
          sellPrice: p.pricePerKg,
          buyPrice: p.buyPricePerKg,
          stock: Math.round(p.stockInGrams / 1000),
          stockMode: "limited",
          userId,
          synced: 1,
          createdAt: new Date().toISOString(),
        }));
        await offlineDB.products.bulkPut(toCache);
      }
    } catch (err) { console.error(err); }
  }, []);

  const syncPendingProducts = useCallback(async () => {
    if (typeof window === "undefined" || !window.navigator.onLine) return;
    const pending = await offlineDB.products.where("synced").equals(0).toArray();
    if (pending.length === 0) return;
    setSyncing(true);
    let synced = 0;
    for (const p of pending) {
      try {
        const isNew = !!p.localId && p.localId.startsWith("local_");
        const url = isNew ? "/api/products" : `/api/products/${p._id}`;
        const method = isNew ? "POST" : "PUT";
        const res = await fetch(url, {
          method, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: p.name,
            category: p.category || "other",
            buyPricePerKg: p.buyPricePerKg,
            pricePerKg: p.pricePerKg,
            stockInGrams: p.stockInGrams,
            localId: p.localId,
          }),
        });
        if (res.ok) { await offlineDB.products.update(p.localId, { synced: 1 }); synced++; }
      } catch { /* ignore */ }
    }
    setPendingCount((prev) => Math.max(0, prev - synced));
    setSyncing(false);
    if (synced > 0) void refreshAfterAction(search, categoryFilter);
  }, [refreshAfterAction, search, categoryFilter]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (currentSearch: string, cat: string, currentPage: number, signal: AbortSignal) => {
      if (currentPage === 1) setLoading(true); else setLoadingMore(true);
      try {
        const cached = await offlineDB.products.toArray();
        setPendingCount(cached.filter((c) => c.synced === 0).length);
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          const searchLower = currentSearch.toLowerCase();
          const filtered = cached.filter((c) => {
            const matchSearch = !currentSearch || c.name.toLowerCase().includes(searchLower);
            const matchCat = cat === "all" || c.category === cat;
            return matchSearch && matchCat;
          });
          const limit = currentPage * 20;
          const paged = filtered.slice(0, limit).map((c): Product => ({
            _id: c._id || c.localId,
            name: c.name,
            category: toProductCategory(c.category),
            buyPricePerKg: c.buyPricePerKg || 0,
            pricePerKg: c.pricePerKg || 0,
            stockInGrams: c.stockInGrams ?? 0,
            localId: c.localId,
            synced: c.synced,
          }));
          setProducts(paged);
          setPagination({ page: currentPage, totalPages: Math.ceil(filtered.length / 20) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length });
          return;
        }
        const res = await fetch(`/api/products?search=${encodeURIComponent(currentSearch)}&category=${cat}&page=${currentPage}&limit=20`, { signal });
        const data = (await res.json()) as ProductsResponse;
        if (Array.isArray(data)) {
          setProducts(data as Product[]); setPagination({ page: 1, totalPages: 1, hasMore: false, totalCount: data.length });
        } else {
          if (currentPage === 1) setProducts(data.products); else setProducts((prev) => [...prev, ...data.products]);
          setPagination(data.pagination);
        }
      } catch (err) { if ((err as Error).name !== "AbortError") console.error(err); }
      finally { setLoading(false); setLoadingMore(false); }
    };
    void load(search, categoryFilter, page, controller.signal);
    return () => controller.abort();
  }, [search, categoryFilter, page]);

  useEffect(() => {
    if (isOnline) {
      const t = setTimeout(() => { void syncPendingProducts(); }, 500);
      return () => clearTimeout(t);
    }
  }, [isOnline, syncPendingProducts]);

  const handleSearchChange = (value: string) => { setSearch(value); setPage(1); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const buy = rnd(Number(form.buyPricePerKg));
    const sell = rnd(Number(form.pricePerKg));
    const stockG = rnd(Number(form.stockInGrams));
    if (!form.name.trim()) { alert("Name required"); return; }
    if (buy <= 0 || sell <= 0) { alert("Buy & Sell per Kg required"); return; }
    const payload = { name: form.name.trim(), category: form.category, buyPricePerKg: buy, pricePerKg: sell, stockInGrams: stockG };
    const offlineUser = getOfflineUser() as OfflineUser;
    setUpdating(true);
    try {
      if (isOffline) {
        const localId = editId && editId.startsWith("local_") ? editId : generateLocalId();
        await offlineDB.products.put({
          _id: editId && !editId.startsWith("local_") ? editId : localId,
          localId, name: payload.name, category: payload.category,
          buyPricePerKg: buy, pricePerKg: sell, stockInGrams: stockG,
          buyPrice: buy, buyPriceAvg: buy, sellPrice: sell, stock: Math.round(stockG / 1000),
          stockMode: "limited", userId: offlineUser?._id || "offline", synced: 0, createdAt: new Date().toISOString(),
        });
        setPendingCount((c) => c + 1);
        setForm({ name: "", category: "dryfruit", buyPricePerKg: "", pricePerKg: "", stockInGrams: "1000" });
        setEditId(null); await refreshAfterAction(search, categoryFilter); return;
      }
      const url = editId && !editId.startsWith("local_") ? `/api/products/${editId}` : "/api/products";
      const method = editId && !editId.startsWith("local_") ? "PUT" : "POST";
      const body = editId && editId.startsWith("local_") ? { ...payload, localId: editId } : payload;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("failed");
      if (editId && editId.startsWith("local_")) await offlineDB.products.delete(editId);
    } catch (err) {
      console.error(err);
      const localId = editId || generateLocalId();
      await offlineDB.products.put({
        _id: localId, localId, name: payload.name, category: payload.category,
        buyPricePerKg: buy, pricePerKg: sell, stockInGrams: stockG,
        buyPrice: buy, buyPriceAvg: buy, sellPrice: sell, stock: Math.round(stockG / 1000),
        stockMode: "limited", userId: offlineUser?._id || "offline", synced: 0, createdAt: new Date().toISOString(),
      });
      setPendingCount((c) => c + 1);
    } finally { setUpdating(false); }
    setForm({ name: "", category: "dryfruit", buyPricePerKg: "", pricePerKg: "", stockInGrams: "1000" });
    setEditId(null); await refreshAfterAction(search, categoryFilter);
  };

  const handleEdit = (p: Product) => {
    setEditId(p._id);
    setForm({ name: p.name, category: p.category, buyPricePerKg: String(p.buyPricePerKg), pricePerKg: String(p.pricePerKg), stockInGrams: String(p.stockInGrams) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this product?")) return;
    setDeletingId(id);
    try {
      if (id.startsWith("local_")) { await offlineDB.products.delete(id); setPendingCount((c) => Math.max(0, c - 1)); await refreshAfterAction(search, categoryFilter); return; }
      await fetch(`/api/products/${id}`, { method: "DELETE" });
      await refreshAfterAction(search, categoryFilter);
    } catch (err) { console.error(err); } finally { setDeletingId(null); }
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • {pendingCount} pending</div>}
      {pendingCount > 0 && !isOffline && <div className="mb-3 bg-blue-50 border border-blue-200 text-blue-800 text-[12px] p-2.5 rounded-xl flex justify-between"><span>{pendingCount} pending sync</span><button onClick={() => syncPendingProducts()} disabled={syncing} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-[11px]">{syncing ? "Syncing..." : "Sync Now"}</button></div>}
      <div className="flex flex-col gap-3 mb-4">
        <h1 className="text-[20px] font-bold">🌶️ Shahsawar Masala - Stock (Grams)</h1>
        <div className="flex gap-1.5 sm:gap-2">
          <input placeholder="🔍 Kishmish, Kajoor, Haldi..." value={search} onChange={(e) => handleSearchChange(e.target.value)} className="border p-2 sm:p-2.5 rounded-xl flex-1 bg-white text-[12px] sm:text-[14px]" />
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="border p-2 sm:p-2.5 rounded-xl bg-white text-[11px] sm:text-[13px]">
            <option value="all">All</option>
            <option value="dryfruit">🥜 Dry Fruit</option>
            <option value="pansar">🌿 Pansar</option>
            <option value="masala_raw">🌶️ Masala Raw</option>
            <option value="masala_mix">🌶️ Mix Masala</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-3 rounded-xl shadow-sm border mb-6">
        <p className="font-semibold mb-3 text-[13px]">{editId ? "Edit Product" : "Add Masala Product"}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Name * e.g Kishmish, Kajoor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border p-2.5 rounded-lg col-span-2 sm:col-span-2 text-[13px]" required />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SaleCategory })} className="border p-2.5 rounded-lg bg-white text-[13px]">
            <option value="dryfruit">🥜 Dry Fruit</option>
            <option value="pansar">🌿 Pansar</option>
            <option value="masala_raw">🌶️ Masala Raw</option>
            <option value="masala_mix">🌶️ Mix Masala</option>
            <option value="other">Other</option>
          </select>
          <input placeholder="Buy /Kg * e.g 600" type="number" value={form.buyPricePerKg} onChange={(e) => setForm({ ...form, buyPricePerKg: e.target.value })} className="border p-2.5 rounded-lg text-[13px] bg-red-50" required />
          <input placeholder="Sell /Kg * e.g 800" type="number" value={form.pricePerKg} onChange={(e) => setForm({ ...form, pricePerKg: e.target.value })} className="border p-2.5 rounded-lg text-[13px] bg-green-50" required />
          <input placeholder="Stock grams * e.g 5000" type="number" value={form.stockInGrams} onChange={(e) => setForm({ ...form, stockInGrams: e.target.value })} className="border p-2.5 rounded-lg text-[13px]" required />
        </div>
        {Number(form.buyPricePerKg) > 0 && Number(form.pricePerKg) > 0 && (
          <p className="mt-2 text-[12px] text-green-600">
            Profit: Rs.{rnd(Number(form.pricePerKg) - Number(form.buyPricePerKg))}/kg | Stock Value Buy Rs.{rnd((Number(form.buyPricePerKg) * Number(form.stockInGrams || 0)) / 1000)} | {gramsToKgG(Number(form.stockInGrams) || 0)}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          <button type="submit" disabled={updating} className="bg-green-600 text-white px-6 py-2 rounded-lg text-[13px] disabled:opacity-50">{updating ? "Saving..." : editId ? "Update" : "+ Add Stock"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm({ name: "", category: "dryfruit", buyPricePerKg: "", pricePerKg: "", stockInGrams: "1000" }); }} className="bg-gray-100 px-6 py-2 rounded-lg text-[13px]">Cancel</button>}
        </div>
      </form>

      {loading ? <p className="text-center py-10 text-[13px]">Loading...</p> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {products.map((p) => {
              const profit = p.pricePerKg - p.buyPricePerKg;
              const totalBuy = (p.stockInGrams / 1000) * p.buyPricePerKg;
              const totalSell = (p.stockInGrams / 1000) * p.pricePerKg;
              const isLow = p.stockInGrams > 0 && p.stockInGrams <= 500;
              return (
                <div key={p._id} className={`bg-white border p-3 rounded-xl shadow-sm ${isLow ? "border-amber-300" : ""}`}>
                  <div className="flex justify-between"><p className="font-semibold text-[13px] truncate">{p.name}</p><span className={`text-[10px] px-2 py-0.5 rounded-full ${p.category === "dryfruit" ? "bg-amber-100 text-amber-700" : p.category === "pansar" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>{p.category} {isLow ? "⚠️ LOW" : ""}</span></div>
                  <p className="text-[11px] text-gray-500">Stock: {gramsToKgG(p.stockInGrams)} • {p.stockInGrams}g</p>
                  <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
                    <div className="bg-red-50 p-1.5 rounded text-center"><div className="text-gray-500">Buy/kg</div><div className="font-bold">Rs.{rnd(p.buyPricePerKg)}</div><div className="border-t mt-1 pt-1">Total {rnd(totalBuy)}</div></div>
                    <div className="bg-blue-50 p-1.5 rounded text-center"><div className="text-gray-500">Sell/kg</div><div className="font-bold">Rs.{rnd(p.pricePerKg)}</div><div className="border-t mt-1 pt-1">Total {rnd(totalSell)}</div></div>
                    <div className="bg-green-50 p-1.5 rounded text-center"><div className="text-gray-500">Profit/kg</div><div className="font-bold text-green-700">Rs.{rnd(profit)}</div><div className="border-t mt-1 pt-1">{rnd(totalSell - totalBuy)}</div></div>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => handleEdit(p)} className="flex-1 bg-blue-50 text-blue-600 py-1.5 rounded-lg text-[11px]">Edit</button>
                    <button onClick={() => handleDelete(p._id)} disabled={deletingId === p._id} className="flex-1 bg-red-50 text-red-600 py-1.5 rounded-lg text-[11px]">{deletingId === p._id ? "..." : "Del"}</button>
                  </div>
                </div>
              );
            })}
          </div>
          {pagination.hasMore && <button onClick={() => setPage((pr) => pr + 1)} disabled={loadingMore} className="w-full mt-4 py-2.5 bg-white border rounded-xl text-[13px]">{loadingMore ? "Loading..." : `More (${pagination.totalCount - products.length})`}</button>}
        </>
      )}
    </div>
  );
}