"use client";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline-db";

type Product = { _id: string; name: string; category: string; pricePerKg: number; buyPricePerKg: number; stockInGrams: number; stockMode: string; };
type SaleItem = { productName: string; weightGrams: number; total: number; profit: number; createdAt: string; customerName?: string; status?: string; pricePerKg?: number; };
type TopItem = { _id: string; category?: string; totalWeightGrams: number; totalSale: number; totalProfit: number; count: number };
type Block = { total: number; profit: number; profitPositive?: number; profitNegative?: number; count: number; cash?: number; credit?: number; buy?: number; };
type ReportsApi = {
  today: Block; month: Block; year: Block; all: Block;
  stock: { stockValue: number; stockValueSell: number; lowCount: number; lowValue: number; lowValueSell: number; };
  khata: { totalUdhar: number; customers: number; totalWusool: number; wusoolCustomers: number; };
  todayRecent: SaleItem[];
};

type ApiProducts = Product[] | { products: Product[] };
type ApiTop = { top: TopItem[] };
type ApiCustomers = { customers: { totalUdhar?: number; isPaid?: boolean }[] };

function useIsOnline(){
  const sub = useCallback((cb:()=>void)=>{ window.addEventListener("online",cb); window.addEventListener("offline",cb); return ()=>{ window.removeEventListener("online",cb); window.removeEventListener("offline",cb);};},[]);
  const snap = useCallback(()=> navigator.onLine,[]);
  const ss = useCallback(()=> true,[]);
  return useSyncExternalStore(sub,snap,ss);
}
function fmt(n:number){ return Math.round(n||0).toLocaleString(); }
function gramsToKgG(g:number){ const kg=Math.floor((g||0)/1000); const gram=(g||0)%1000; if(kg>0) return `${kg}kg ${gram}g`; return `${gram}g`; }

export default function MasalaDashboard(){
  const isOnline = useIsOnline();
  const isOffline = !isOnline;
  const [products, setProducts] = useState<Product[]>([]);
  const [recentSales, setRecentSales] = useState<SaleItem[]>([]);
  const [reports, setReports] = useState<ReportsApi | null>(null);
  const [topProducts, setTopProducts] = useState<TopItem[]>([]);
  const [topFilter, setTopFilter] = useState<"today"|"weekly"|"monthly"|"all">("monthly");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(()=>{
    const ctrl = new AbortController();
    const load = async()=>{
      try{
        const offlineNow = typeof window!=="undefined" && !window.navigator.onLine;
        if(offlineNow){
          const offlineProds = await offlineDB.products.toArray();
          const offlineSales = await offlineDB.sales.orderBy("createdAt").reverse().toArray();
          const offlineCustomers = await offlineDB.customers.toArray();
          const pending = await offlineDB.sales.where("synced").equals(0).count();

          const mappedProds = offlineProds.map(p=>({
            _id: p._id || p.localId, name: p.name, category: p.category || "other",
            pricePerKg: p.pricePerKg, buyPricePerKg: p.buyPricePerKg || p.buyPriceAvg || 0,
            stockInGrams: p.stockInGrams || 0, stockMode: p.stockMode || "limited"
          })) as Product[];

          const mappedSales = offlineSales.slice(0,8).map(s=>({
            productName: s.productName, weightGrams: s.weightGrams, total: s.total,
            profit: s.profit, createdAt: s.createdAt, customerName: s.customerName,
            status: s.status, pricePerKg: s.pricePerKg
          })) as SaleItem[];

          setProducts(mappedProds);
          setRecentSales(mappedSales);
          setPendingCount(pending);

          const today = new Date(); today.setHours(0,0,0,0);
          const now = new Date();
          const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const startYear = new Date(now.getFullYear(), 0, 1);

          let tT=0,tP=0,tC=0,mT=0,mP=0,mC=0,yT=0,yPP=0,yPN=0,yC=0;
          offlineSales.forEach(s=>{
            const d = new Date(s.createdAt);
            if(d>=today){ tT+=s.total; tP+=s.profit; tC++; }
            if(d>=startMonth){ mT+=s.total; mP+=s.profit; mC++; }
            if(d>=startYear){ yT+=s.total; if(s.profit>=0) yPP+=s.profit; else yPN+=Math.abs(s.profit); yC++; }
          });

          // STOCK VALUE BY GRAMS
          const stockValue = mappedProds.reduce((a,p)=> a + (p.stockInGrams/1000) * p.buyPricePerKg, 0);
          const stockValueSell = mappedProds.reduce((a,p)=> a + (p.stockInGrams/1000) * p.pricePerKg, 0);
          const lowList = mappedProds.filter(p=> p.stockMode!=="unlimited" && p.stockInGrams>0 && p.stockInGrams<=500);
          const lowCount = lowList.length;
          const lowValue = lowList.reduce((a,p)=> a + (p.stockInGrams/1000) * p.buyPricePerKg, 0);
          const lowValueSell = lowList.reduce((a,p)=> a + (p.stockInGrams/1000) * p.pricePerKg, 0);
          const totalUdhar = offlineCustomers.filter(c=>!c.isPaid).reduce((a,c)=>a+(c.totalUdhar||0),0);

          setReports({
            today:{ total:tT, profit:tP, count:tC },
            month:{ total:mT, profit:mP, count:mC },
            year:{ total:yT, profit:yPP-yPN, profitPositive:yPP, profitNegative:yPN, count:yC },
            all:{ total:yT, profit:yPP-yPN, count:yC },
            stock:{ stockValue, stockValueSell, lowCount, lowValue, lowValueSell },
            khata:{ totalUdhar, customers: offlineCustomers.filter(c=>!c.isPaid).length, totalWusool:0, wusoolCustomers:0 },
            todayRecent: mappedSales,
          });
        } else {
          const [prodRes, reportRes, topRes, customerRes, pendingArr] = await Promise.all([
            fetch("/api/products?limit=200",{signal:ctrl.signal}),
            fetch("/api/reports",{signal:ctrl.signal}),
            fetch(`/api/sales/top?filter=${topFilter}`,{signal:ctrl.signal}),
            fetch("/api/customers?search=",{signal:ctrl.signal}),
            offlineDB.sales.where("synced").equals(0).toArray(),
          ]);
          const prodJson = await prodRes.json() as ApiProducts;
          const reportJson = await reportRes.json() as ReportsApi;
          const topJson = await topRes.json() as ApiTop;
          const custJson = await customerRes.json() as ApiCustomers;

          setProducts(Array.isArray(prodJson) ? prodJson : (prodJson.products||[]));
          setReports(reportJson);
          setRecentSales(reportJson.todayRecent || []);
          setTopProducts(topJson.top||[]);
          setPendingCount(pendingArr.length);

          if(reportJson.khata.totalUdhar===0){
            const list = custJson.customers||[];
            const filtered = list.filter(c=>!c.isPaid);
            if(filtered.length>0){
              setReports(prev=> prev ? ({...prev, khata:{...prev.khata, totalUdhar: filtered.reduce((a,c)=>a+(c.totalUdhar||0),0), customers: filtered.length}}) : prev);
            }
          }
        }
      }catch{} finally{ setLoading(false); }
    };
    void load();
    return()=>ctrl.abort();
  },[topFilter]);

  if(loading) return <p className="p-8 text-center text-[12px]">Loading Shahsawar Masala...</p>;

  const lowStock = products.filter(p=>p.stockMode!=="unlimited" && p.stockInGrams>0 && p.stockInGrams<=500).slice(0,6);
  const stockBuy = reports?.stock.stockValue ?? 0;
  const stockSell = reports?.stock.stockValueSell ?? 0;
  const yearSale = reports?.year.total ?? 0;
  const yearProfit = reports?.year.profitPositive ?? reports?.year.profit ?? 0;
  const yearLoss = reports?.year.profitNegative ?? 0;

  return(
    <div className="p-3 sm:p-6 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {isOffline && <div className="mb-3 bg-amber-50 border text-amber-800 text-[12px] p-2.5 rounded-xl text-center">📶 Offline • {pendingCount} pending — will auto-sync</div>}
      {reports && reports.khata.totalUdhar>0 && <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-[12px] p-2.5 rounded-xl flex justify-between"><span>📒 Total Udhar: Rs.{fmt(reports.khata.totalUdhar)} • {reports.khata.customers} customers</span><Link href="/khata" className="bg-red-600 text-white px-3 py-1 rounded-lg text-[11px]">Khata</Link></div>}

      <h1 className="text-[20px] font-bold">🌶️ Shahsawar Masala Dashboard</h1>
      <p className="text-[11px] text-gray-500 mb-4">{new Date().toLocaleDateString()} • {isOffline?"Offline Mode":"Online"} • Year {new Date().getFullYear()} • Shewa</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Today Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.today.total||0)}</p><p className="text-[10px] text-green-600">Profit Rs.{fmt(reports?.today.profit||0)} • {reports?.today.count||0} sales</p></div>
        <div className="bg-white p-4 rounded-xl border"><p className="text-[10px] text-gray-400">Month Sale</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.month.total||0)}</p><p className="text-[10px] text-blue-600">Profit Rs.{fmt(reports?.month.profit||0)} • {reports?.month.count||0} bills</p></div>
        <div className="bg-white p-4 rounded-xl border-2 border-blue-200"><p className="text-[10px] text-blue-600 font-bold">This Year Sale</p><p className="text-[18px] font-bold">Rs.{fmt(yearSale)}</p><p className="text-[10px] text-gray-500">{reports?.year.count||0} bills • Profit Rs.{fmt(yearProfit)}</p></div>
        <div className="bg-white p-4 rounded-xl border border-yellow-300"><p className="text-[10px] text-gray-500 font-bold">Stock Value (Buy)</p><p className="text-[18px] font-bold">Rs.{fmt(stockBuy)}</p><p className="text-[10px] text-gray-600">Sell Rs.{fmt(stockSell)} • Profit Rs.{fmt(stockSell-stockBuy)}</p></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
        <div className="bg-green-50 border border-green-200 p-4 rounded-xl"><p className="text-[10px] text-green-700 font-bold">Yearly Profit</p><p className="text-[18px] font-bold text-green-700">Rs.{fmt(yearProfit)}</p><p className="text-[10px]">This year</p></div>
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl"><p className="text-[10px] text-red-700 font-bold">Yearly Loss</p><p className="text-[18px] font-bold text-red-700">Rs.{fmt(yearLoss)}</p><p className="text-[10px]">Return / damage</p></div>
        <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl"><p className="text-[10px] text-orange-700 font-bold">Total Udhar Khata</p><p className="text-[18px] font-bold">Rs.{fmt(reports?.khata.totalUdhar||0)}</p><p className="text-[10px]">{reports?.khata.customers||0} customers • Shewa</p></div>
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl"><p className="text-[10px] text-yellow-800 font-bold">Low Stock Alert (≤500g)</p><p className="text-[18px] font-bold">{reports?.stock.lowCount||0} Items</p><p className="text-[10px]">Buy Rs.{fmt(reports?.stock.lowValue||0)} • Sell Rs.{fmt(reports?.stock.lowValueSell||0)}</p></div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
        <Link href="/dashboard/sales" className="bg-black text-white p-4 rounded-xl text-center font-bold text-[13px]">🛒 POS Sale</Link>
        <Link href="/dashboard/products" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📦 Masala Stock</Link>
        <Link href="/khata" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📒 Khata</Link>
        <Link href="/dashboard/sales/history" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">📜 History</Link>
        <Link href="/dashboard/sales/top" className="bg-white border p-4 rounded-xl text-center font-bold text-[13px]">🔥 Top Masala</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">Today Recent Sales</b><span className="text-[10px] bg-green-100 px-2 py-0.5 rounded-full">{recentSales.length} today</span></div>
          {recentSales.length===0? <p className="p-4 text-[11px] text-gray-400 text-center">No sales today — Kajoor, Kishmish?</p> : recentSales.map((s,i)=><div key={i} className="p-2 border-b flex justify-between text-[11px]"><span><b>{s.productName}</b> {gramsToKgG(s.weightGrams)} @ Rs.{fmt(s.pricePerKg||s.total)} <span className="text-[9px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString()}</span></span><span className="font-bold">Rs.{fmt(s.total)}</span></div>)}
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="p-3 border-b flex justify-between"><b className="text-[13px]">Low Stock (≤500g) — Buy Rs.{fmt(reports?.stock.lowValue||0)} / Sell Rs.{fmt(reports?.stock.lowValueSell||0)}</b><Link href="/dashboard/products" className="text-[10px] bg-red-100 px-2 py-0.5 rounded-full">Manage</Link></div>
          {lowStock.length===0? <p className="p-4 text-[11px] text-gray-400 text-center">All stock OK — 0 low</p> : lowStock.map((p,i)=><div key={i} className="p-2 border-b flex justify-between text-[11px]"><span><b>{p.name}</b> • {gramsToKgG(p.stockInGrams)} • Buy Rs.{fmt(p.buyPricePerKg)}/kg • Sell Rs.{fmt(p.pricePerKg)}/kg</span><span className="text-red-600 font-bold">Only {gramsToKgG(p.stockInGrams)}</span></div>)}
          <div className="p-3 border-t">
            <div className="flex gap-1 mb-2">{(["today","weekly","monthly","all"] as const).map(f=><button key={f} onClick={()=>setTopFilter(f)} className={`px-3 py-1 rounded-full text-[10px] font-bold capitalize ${topFilter===f?"bg-black text-white":"bg-gray-100"}`}>{f}</button>)}</div>
            {topProducts.slice(0,5).map((t,i)=><div key={i} className="flex justify-between text-[11px] py-1 border-b"><span>{i+1}. {t._id} • {gramsToKgG(t.totalWeightGrams)}</span><span className="font-bold">Rs.{fmt(t.totalSale)}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}