"use client";
import { useEffect, useState, useCallback, useSyncExternalStore, useRef } from "react";
import { offlineDB, calcProfit, calcTotal } from "@/lib/offline-db";
import type { OfflineSale, OfflineProduct, SaleCategory, SaleType } from "@/lib/offline-db";
import { getOfflineUser } from "@/lib/offline-auth";

type Product = { _id: string; name: string; category: SaleCategory; buyPricePerKg: number; pricePerKg: number; stockInGrams: number; stockMode: "limited"|"unlimited"; };
type Sale = { _id: string; productId?: string; mixId?: string; productName: string; category: SaleCategory; weightGrams: number; pricePerKg: number; total: number; profit: number; createdAt: string; customerName?: string; status?: string; paymentType?: string; saleType?: SaleType };
type CartItem = { cartId: string; productId?: string; mixId?: string; name: string; weightGrams: number; pricePerKg: number; total: number; category: SaleCategory; buyPricePerKg: number; saleType: SaleType };
type FilterType = "today"|"weekly"|"monthly"|"all";
type Pagination = { page: number; totalPages: number; hasMore: boolean; totalCount: number };
type SalesApiResponse = { sales: Sale[]; pagination: Pagination };
type ProductApiResponse = { products: Product[]; pagination?: Pagination } | Product[];
type OfflineUser = { _id?: string; id?: string } | null;
type SessionRes = { user?: { id?: string; _id?: string } };

function useIsOnline(){
  const sub = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const snap = useCallback(()=> navigator.onLine,[]);
  const ss = useCallback(()=> true,[]);
  return useSyncExternalStore(sub,snap,ss);
}
function rnd(n:number){return Math.round(n||0);}
function fmt(n:number){return rnd(n).toString();}
function gramsToKgG(g:number){ const kg=Math.floor(g/1000); const gram=g%1000; if(kg>0) return `${kg}kg ${gram}g`; return `${gram}g`; }

const WEIGHT_OPTIONS = [100,200,250,500,1000,2000,5000];

export default function SalesPage(){
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [weightMap, setWeightMap] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<FilterType>("today");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({page:1,totalPages:1,hasMore:false,totalCount:0});
  const [productPage, setProductPage] = useState(1);
  const [productPagination, setProductPagination] = useState<Pagination>({page:1,totalPages:1,hasMore:false,totalCount:0});
  const [productSearch, setProductSearch] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [loadingSales, setLoadingSales] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [customerName, setCustomerName] = useState("Walk-in");
  const [paymentType, setPaymentType] = useState<"cash"|"credit">("cash");
  const [pendingCount, setPendingCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [customerError, setCustomerError] = useState(false);
  const isOnlineHook = useIsOnline();
  const isOffline = mounted && !isOnlineHook;
  const searchRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ setMounted(true); },[]);
  const refreshCounts = useCallback(async()=>{ try{ const c=await offlineDB.sales.where("synced").equals(0).count(); setPendingCount(c);}catch{} },[]);

  const syncPendingSales = useCallback(async()=>{
    try{
      if(!navigator.onLine) return;
      const pending = await offlineDB.sales.where("synced").equals(0).toArray();
      if(pending.length===0){ await refreshCounts(); return; }
      for(const s of pending){
        try{
          const res = await fetch("/api/sales",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ productId:s.productId, mixId:s.mixId, productName:s.productName, weightGrams:s.weightGrams, pricePerKg:s.pricePerKg, buyPricePerKg:s.buyPricePerKg, customerName:s.customerName, paymentType:s.paymentType, category:s.category, saleType:s.saleType, userId:s.userId, localId:s.localId, }) });
          if(res.ok){ await offlineDB.sales.update(s.localId, {synced:1}); }
        }catch{}
      }
      await refreshCounts();
    }catch{}
  },[refreshCounts]);

  const cacheAllProductsOnce = useCallback(async()=>{
    try{
      const res = await fetch(`/api/products?search=&category=all&page=1&limit=500`);
      const data = await res.json() as ProductApiResponse;
      const list = Array.isArray(data) ? data : data.products;
      const offlineUser = getOfflineUser() as OfflineUser;
      const userId = offlineUser?._id || offlineUser?.id || "offline";
      const toCache: OfflineProduct[] = list.map((p)=>({
        _id: p._id, localId: p._id, name: p.name, category: p.category, pricePerKg: p.pricePerKg, buyPricePerKg: p.buyPricePerKg, stockInGrams: p.stockInGrams, buyPriceAvg: p.buyPricePerKg, sellPrice: p.pricePerKg, buyPrice: p.buyPricePerKg, stock: Math.round(p.stockInGrams/1000), stockMode: p.stockMode, userId, synced: 1, createdAt: new Date().toISOString(),
      }));
      await offlineDB.products.bulkPut(toCache);
      alert(`Cached ${toCache.length} products for offline!`);
    }catch{ alert("Cache failed"); }
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      if(productPage===1) setLoadingProducts(true);
      else setLoadingMoreProducts(true);
      try{
        if(!navigator.onLine){
          const cached=await offlineDB.products.toArray();
          const filtered=cached.filter((c)=>{ 
            const s=productSearch.toLowerCase(); 
            return (!s||c.name.toLowerCase().includes(s)) && (categoryFilter==="all"||c.category===categoryFilter); 
          });
          const LIMIT = 20;
          const paged = filtered.slice(0, productPage * LIMIT);
          const mapped: Product[] = paged.map((c)=>({ 
            _id:c._id||c.localId, name:c.name, category:(c.category as SaleCategory)||"other", 
            buyPricePerKg:c.buyPricePerKg||0, pricePerKg:c.pricePerKg||0, stockInGrams:c.stockInGrams||0, stockMode:c.stockMode||"limited" 
          }));
          if(!cancelled){
            setProducts(mapped);
            setProductPagination({ page: productPage, totalPages: Math.ceil(filtered.length / LIMIT) || 1, hasMore: filtered.length > paged.length, totalCount: filtered.length });
          }
        } else {
          const res=await fetch(`/api/products?search=${encodeURIComponent(productSearch)}&category=${categoryFilter}&page=${productPage}&limit=20`);
          const data=(await res.json()) as ProductApiResponse;
          let list: Product[] = [];
          let pag: Pagination | undefined;
          if(Array.isArray(data)){ list = data; }
          else { list = data.products; pag = data.pagination; }
          if(list.length>0){
            const offlineUser = getOfflineUser() as OfflineUser;
            const userId = offlineUser?._id || offlineUser?.id || "offline";
            const toCache: OfflineProduct[] = list.map((p)=>({
              _id: p._id, localId: p._id, name: p.name, category: p.category, pricePerKg: p.pricePerKg, buyPricePerKg: p.buyPricePerKg, stockInGrams: p.stockInGrams, buyPriceAvg: p.buyPricePerKg, sellPrice: p.pricePerKg, buyPrice: p.buyPricePerKg, stock: Math.round(p.stockInGrams/1000), stockMode: p.stockMode, userId, synced: 1, createdAt: new Date().toISOString(),
            }));
            await offlineDB.products.bulkPut(toCache).catch(()=>{});
          }
          if(!cancelled){
            if(productPage===1) setProducts(list);
            else setProducts((prev)=>[...prev, ...list]);
            if(pag) setProductPagination(pag);
          }
        }
      }catch{} finally{ if(!cancelled){ setLoadingProducts(false); setLoadingMoreProducts(false); } }
    };
    void load(); return()=>{ cancelled=true; };
  },[productSearch, categoryFilter, productPage]);

  const loadSales=useCallback(async(f:FilterType,p:number)=>{
    setLoadingSales(true);
    try{
      if(!navigator.onLine){
        const all=await offlineDB.sales.orderBy("createdAt").reverse().toArray();
        let filtered=all as OfflineSale[];
        const now=new Date();
        if(f==="today") filtered=filtered.filter((s)=>new Date(s.createdAt).toDateString()===now.toDateString());
        if(f==="weekly"){ const w=new Date(); w.setDate(now.getDate()-7); filtered=filtered.filter((s)=>new Date(s.createdAt)>=w); }
        if(f==="monthly"){ const m=new Date(); m.setMonth(now.getMonth()-1); filtered=filtered.filter((s)=>new Date(s.createdAt)>=m); }
        const mapped: Sale[]=filtered.slice((p-1)*20,p*20).map((o)=>({ _id:o.localId, productId:o.productId, productName:o.productName, category:o.category||"other", weightGrams:o.weightGrams, pricePerKg:o.pricePerKg, total:o.total, profit:o.profit, createdAt:o.createdAt, customerName:o.customerName, status:o.status, paymentType:o.paymentType, saleType:o.saleType }));
        if(p===1) setSales(mapped); else setSales((prev)=>[...prev,...mapped]);
        setPagination({page:p,totalPages:Math.ceil(filtered.length/20),hasMore:filtered.length>p*20,totalCount:filtered.length});
      } else {
        const res=await fetch(`/api/sales?filter=${f}&page=${p}&limit=20`);
        const data=(await res.json()) as SalesApiResponse;
        const list=data.sales||[];
        if(p===1) setSales(list); else setSales((prev)=>[...prev,...list]);
        setPagination(data.pagination||{page:p,totalPages:1,hasMore:false,totalCount:list.length});
      }
    }catch{} finally{ setLoadingSales(false); }
  },[]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ void loadSales(filter,page); void refreshCounts(); void syncPendingSales(); },[filter,page,loadSales,refreshCounts,syncPendingSales]);

  const total=sales.reduce((a,b)=>a+b.total,0);
  const profit=sales.reduce((a,b)=>a+b.profit,0);

  const updateProductPrice = (id:string, newPrice:number)=>{ if(newPrice<1) return; setProducts((prev)=>prev.map((p)=>p._id===id?{...p, pricePerKg:rnd(newPrice)}:p)); };

  const addToCart=useCallback((p:Product, weight:number)=>{
    if(p.stockMode==="limited" && p.stockInGrams<=0){ alert(`Out of stock: ${p.name} - 0g`); return; }
    if(paymentType==="credit"){
      const name=customerName.trim();
      if(name.length<2 || name.toLowerCase()==="walk-in"){
        setCustomerError(true);
        alert("Customer name required for Udhar!");
        customerInputRef.current?.focus();
        return;
      }
    }
    setCart((prev)=>{
      const totalInCart = prev.filter((c)=>c.productId===p._id).reduce((s,c)=>s+c.weightGrams,0);
      if(p.stockMode==="limited" && p.stockInGrams < totalInCart + weight){
        alert(`Only ${gramsToKgG(p.stockInGrams)} left for ${p.name}, you have ${gramsToKgG(totalInCart)} in cart. Can add max ${gramsToKgG(Math.max(0,p.stockInGrams-totalInCart))} more`);
        return prev;
      }
      const newItem: CartItem = {
        cartId: `${p._id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        productId: p._id,
        name: p.name,
        weightGrams: rnd(weight),
        pricePerKg: p.pricePerKg,
        total: calcTotal(p.pricePerKg, weight),
        category: p.category,
        buyPricePerKg: p.buyPricePerKg,
        saleType: "loose",
      };
      return [...prev, newItem];
    });
  },[paymentType, customerName]);

  const removeFromCart=(cartId:string)=>setCart((prev)=>prev.filter((c)=>c.cartId!==cartId));
  const cartTotal=cart.reduce((s,c)=>s+c.total,0);
  const cartProfit=cart.reduce((s,c)=>s+calcProfit(c.pricePerKg,c.buyPricePerKg,c.weightGrams),0);

  const checkout=useCallback(async()=>{
    if(cart.length===0){ alert("Cart empty"); return; }
    if(paymentType==="credit"){
      const name=customerName.trim();
      if(name.length<2 || name.toLowerCase()==="walk-in"){
        setCustomerError(true);
        alert("Customer name required for Udhar!");
        customerInputRef.current?.focus();
        return;
      }
    }
    const finalCustomer=customerName.trim()||"Walk-in";
    const copy=[...cart];
    const now=new Date().toISOString();
    let sessionUserId = "";
    try {
      const res = await fetch("/api/auth/session");
      if(res.ok){
        const data = await res.json() as SessionRes;
        sessionUserId = data?.user?.id || data?.user?._id || "";
      }
    } catch{}
    const offlineUser = getOfflineUser() as OfflineUser;
    const rawUserId = offlineUser?._id || offlineUser?.id || sessionUserId || "offline_user";
    
    const newSales: Sale[]=copy.map((c,i)=>({
      _id:`local_${Date.now()}_${i}_${Math.random().toString(36).slice(2,4)}`,
      productId:c.productId,
      productName:c.name,
      category:c.category,
      weightGrams:c.weightGrams,
      pricePerKg:c.pricePerKg,
      total:c.total,
      profit:calcProfit(c.pricePerKg,c.buyPricePerKg,c.weightGrams),
      createdAt:now,
      customerName:finalCustomer,
      status:paymentType==="credit"?"pending":"paid",
      paymentType,
      saleType:c.saleType,
    }));
    
    setSales((prev)=>[...newSales, ...prev]);
    setCart([]);

    for(let i=0;i<copy.length;i++){
      const c=copy[i];
      const saleToSave: OfflineSale = {
        localId: newSales[i]._id,
        productId: c.productId,
        productName: c.name,
        category: c.category,
        saleType: c.saleType,
        weightGrams: c.weightGrams,
        pricePerKg: c.pricePerKg,
        buyPricePerKg: c.buyPricePerKg,
        quantity: c.weightGrams/1000,
        buyPriceAvg: c.buyPricePerKg,
        sellPrice: c.pricePerKg,
        total: c.total,
        profit: newSales[i].profit,
        customerName: finalCustomer,
        paymentType: paymentType,
        status: paymentType==="credit"?"pending":"paid",
        userId: rawUserId,
        createdAt: now,
        synced: 0,
      };
      try{ await offlineDB.sales.put(saleToSave); }catch{}
    }
    await refreshCounts();

    if(navigator.onLine){
      for(let i=0;i<copy.length;i++){
        const c=copy[i];
        try{
          const res = await fetch("/api/sales",{ 
            method:"POST", 
            headers:{"Content-Type":"application/json"}, 
            body:JSON.stringify({ 
              productId:c.productId, productName:c.name, weightGrams:c.weightGrams, 
              pricePerKg:c.pricePerKg, buyPricePerKg:c.buyPricePerKg, 
              customerName:finalCustomer, paymentType, category:c.category, saleType:c.saleType,
              userId: sessionUserId || rawUserId, localId: newSales[i]._id,
            }) 
          });
          if(res.ok){
            try{ await offlineDB.sales.update(newSales[i]._id, {synced:1}); }catch{}
          } else {
            const text = await res.text();
            alert(`Mongo ${res.status}: ${text}`);
          }
        }catch{}
      }
      await refreshCounts();
    }
    setProducts((prev)=>prev.map((prod)=>{
      const totalGrams = copy.filter((x)=>x.productId===prod._id).reduce((s,x)=>s+x.weightGrams,0);
      return totalGrams>0 && prod.stockMode==="limited" ? {...prod, stockInGrams:Math.max(0,prod.stockInGrams-totalGrams)} : prod;
    }));
  },[cart, customerName, paymentType, refreshCounts]);

  return(
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <h1 className="font-bold text-[18px]">🌶️ Shahsawar Masala {isOffline?"📶 Offline":""}</h1>
        <div className="flex gap-2">
          <span className="bg-green-600 text-white px-3 py-1 rounded-full text-[11px]">Sale Rs.{fmt(total)}</span>
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px]">Profit Rs.{fmt(profit)}</span>
          {pendingCount>0 && <span className="bg-amber-500 text-white px-3 py-1 rounded-full text-[11px]">{pendingCount} pending</span>}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-2">
            <input ref={searchRef} value={productSearch} onChange={(e)=>{setProductSearch(e.target.value); setProductPage(1);}} placeholder="🔍 Kishmish, Kajoor, Haldi..." className="flex-1 border p-2.5 rounded-xl bg-white text-[13px]" />
            <select value={categoryFilter} onChange={(e)=>{setCategoryFilter(e.target.value); setProductPage(1);}} className="border p-2.5 rounded-xl bg-white text-[12px]"><option value="all">All</option><option value="dryfruit">🥜 Dry Fruit</option><option value="pansar">🌿 Pansar</option><option value="masala_raw">🌶️ Masala Raw</option><option value="masala_mix">🌶️ Mix</option><option value="other">Other</option></select>
          </div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] text-gray-500">Showing {products.length}/{productPagination.totalCount} products</p>
            {!isOffline && <button onClick={()=>void cacheAllProductsOnce()} className="text-[10px] bg-black text-white px-2 py-1 rounded-lg">Cache All for Offline</button>}
          </div>
          {loadingProducts? <p className="text-center py-6 text-[12px]">Loading...</p> : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {products.map((p)=>{
                const w=weightMap[p._id]||250; const buy=p.buyPricePerKg||0;
                const isOutOfStock = p.stockMode==="limited" && p.stockInGrams<=0;
                const cartGrams = cart.filter((c)=>c.productId===p._id).reduce((s,c)=>s+c.weightGrams,0);
                const remaining = p.stockMode==="limited" ? Math.max(0, p.stockInGrams - cartGrams) : 999999;
                return(
                  <div key={p._id} className={`bg-white border rounded-xl p-3 ${isOutOfStock ? "opacity-70 bg-red-50 border-red-200" : ""}`}>
                    <p className="font-bold text-[13px] truncate">{p.name} {isOutOfStock && <span className="text-red-600 text-[10px] ml-1">● OUT</span>}</p>
                    <p className="text-[11px] text-gray-500">{p.category} • Stock {p.stockMode==="unlimited"?"∞":gramsToKgG(p.stockInGrams)} {p.stockMode==="limited" && !isOutOfStock ? `(Left ${gramsToKgG(remaining)})` : ""} • Buy {fmt(buy)}/kg</p>
                    <div className="flex gap-2 mt-2 items-center">
                      <span className="text-[11px]">Sell Rs.</span>
                      <input type="number" value={p.pricePerKg} onChange={(e)=>updateProductPrice(p._id, Number(e.target.value))} className="w-20 border p-1 rounded-lg text-[12px] font-bold bg-yellow-50" disabled={isOutOfStock} />
                      <span className="text-[10px] text-green-600 font-bold ml-auto">Profit {fmt(p.pricePerKg-buy)}/kg</span>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <select value={w} onChange={(e)=>setWeightMap({...weightMap,[p._id]:Number(e.target.value)})} className="border rounded-lg p-1.5 text-[11px] bg-white">
                        {WEIGHT_OPTIONS.map((g)=><option key={g} value={g}>{gramsToKgG(g)}</option>)}
                      </select>
                      <button type="button" onClick={()=>addToCart(p,w)} disabled={isOutOfStock} className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold ${isOutOfStock ? "bg-gray-300 text-gray-500" : "bg-green-600 text-white"}`}>{isOutOfStock ? "Out" : `Add ${gramsToKgG(w)} Rs.${fmt(calcTotal(p.pricePerKg,w))}`}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            {productPagination.hasMore && (
              <button type="button" onClick={()=>setProductPage((pr)=>pr+1)} disabled={loadingMoreProducts} className="w-full mt-3 py-2.5 bg-white border rounded-xl text-[13px] font-bold">
                {loadingMoreProducts ? "Loading..." : `Load More (${productPagination.totalCount - products.length})`}
              </button>
            )}
            </>
          )}
        </div>
        <div className="space-y-3">
          <div className="bg-white border rounded-xl p-3">
            <p className="font-bold text-[13px] mb-2">🛒 Cart ({cart.length}) - Rs.{fmt(cartTotal)}</p>
            <div className="space-y-1 max-h-60 overflow-y-auto mb-3">
              {cart.length===0? <p className="text-[11px] text-gray-400 text-center py-4">Cart empty - select 100g, 500g etc</p> : cart.map((c)=>(
                <div key={c.cartId} className="flex justify-between text-[11px] border-b py-1.5">
                  <span>{c.name} {gramsToKgG(c.weightGrams)} @ {fmt(c.pricePerKg)}/kg</span>
                  <span className="flex gap-2"><b>Rs.{fmt(c.total)}</b><button type="button" onClick={()=>removeFromCart(c.cartId)} className="text-red-600">✕</button></span>
                </div>
              ))}
            </div>
            <input ref={customerInputRef} value={customerName} onChange={(e)=>{ setCustomerName(e.target.value); if(e.target.value.trim().length>=2) setCustomerError(false); }} placeholder="Customer name for Udhar" className={`w-full border p-2 rounded-lg text-[12px] mb-2 ${customerError ? "border-red-500 bg-red-50 ring-2 ring-red-300" : ""}`} />
            {customerError && <p className="text-[10px] text-red-600 mb-2 font-bold">* Customer name required for Udhar</p>}
            <div className="flex bg-gray-100 rounded-lg p-1 mb-3">
              <button type="button" onClick={()=>{ setPaymentType("cash"); setCustomerError(false); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType==="cash"?"bg-green-600 text-white":"text-gray-600"}`}>Cash</button>
              <button type="button" onClick={()=>{ const name=customerName.trim(); if(name.length<2 || name.toLowerCase()==="walk-in"){ setCustomerError(true); alert("Customer name required for Udhar!"); customerInputRef.current?.focus(); return; } setCustomerError(false); setPaymentType("credit"); }} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold ${paymentType==="credit"?"bg-red-600 text-white":"text-gray-600"}`}>Udhar</button>
            </div>
            <button type="button" onClick={()=>{ void checkout(); }} disabled={cart.length===0} className="w-full bg-black text-white py-2.5 rounded-xl font-bold text-[13px] disabled:bg-gray-300">{paymentType==="credit"? `Udhar Rs.${fmt(cartTotal)}` : `Sell Rs.${fmt(cartTotal)} • Profit ${fmt(cartProfit)}`}</button>
            {pendingCount>0 && <button type="button" onClick={()=>void syncPendingSales()} className="w-full mt-2 bg-amber-500 text-white py-2 rounded-xl font-bold text-[11px]">Sync {pendingCount} Pending Now</button>}
          </div>
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="flex gap-1 p-2 border-b bg-gray-50 overflow-x-auto">{(["today","weekly","monthly","all"] as const).map((f)=><button type="button" key={f} onClick={()=>{setFilter(f); setPage(1);}} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${filter===f?"bg-green-600 text-white":"bg-white border"}`}>{f}</button>)}</div>
            {loadingSales? <p className="p-4 text-center text-[11px]">Loading sales...</p> : <div>{sales.map((s)=>(
              <div key={s._id} className={`p-2 border-b flex justify-between text-[11px] ${s.status==="pending"?"bg-red-50":""}`}>
                <div><b>{s.productName}</b> {gramsToKgG(s.weightGrams)} @ Rs.{fmt(s.pricePerKg)}/kg {s.customerName && s.customerName!=="Walk-in"?` 👤${s.customerName}`:""}<div className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()} • Profit {fmt(s.profit)} • {gramsToKgG(s.weightGrams)}</div></div>
                <div className="text-right"><div className="font-bold">Rs.{fmt(s.total)}</div><div className={`text-[9px] ${s.status==="pending"?"text-red-600":"text-green-600"}`}>{s.status==="pending"?"UDHAR":"Paid"}</div></div>
              </div>
            ))}{pagination.hasMore && <button type="button" onClick={()=>setPage((p)=>p+1)} className="w-full py-2 text-[11px] bg-gray-50">Load More</button>}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}