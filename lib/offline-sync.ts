import { offlineDB, calcProfit, calcTotal } from "./offline-db";
import type { OfflineSale, SaleCategory, SaleType, WusoolSyncPayload } from "./offline-db";

export interface SaleInput {
  productId?: string;
  mixId?: string;
  productName: string;
  category: SaleCategory;
  saleType: SaleType;
  weightGrams: number; // 100,200,500,1000,2000
  pricePerKg: number;
  buyPricePerKg: number;
  userId: string;
  customerName?: string;
  phone?: string;
  village?: string;
  paymentType?: "cash" | "credit";
  localId?: string;
}

function genLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function rnd(n: number): number {
  return Math.round(n || 0);
}

type SyncableRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

export async function saveSaleOffline(data: SaleInput): Promise<string> {
  const buyPerKg = rnd(data.buyPricePerKg || 0);
  const sellPerKg = rnd(data.pricePerKg || 0);
  const weightGrams = rnd(data.weightGrams || 100);
  const total = calcTotal(sellPerKg, weightGrams);
  const profit = calcProfit(sellPerKg, buyPerKg, weightGrams);
  const isCredit = data.paymentType === "credit";
  const status = isCredit ? "pending" : "paid";
  const nowISO = new Date().toISOString();
  const localId = data.localId || genLocalId("sale");
  const weightKg = weightGrams / 1000;

  const sale: OfflineSale = {
    localId, 
    productId: data.productId, 
    mixId: data.mixId,
    productName: data.productName,
    category: data.category, 
    saleType: data.saleType,
    weightGrams: weightGrams, 
    pricePerKg: sellPerKg,
    buyPricePerKg: buyPerKg,
    buyPriceAvg: buyPerKg, 
    sellPrice: sellPerKg,
    quantity: weightKg,
    total, 
    profit,
    customerName: data.customerName || "Walk-in",
    paymentType: data.paymentType || "cash", 
    status, 
    userId: data.userId,
    createdAt: nowISO, 
    synced: 0,
  };

  try {
    await offlineDB.transaction("rw", offlineDB.products, offlineDB.sales, offlineDB.customers, offlineDB.syncQueue, async () => {
      try {
        if (data.saleType === "loose" && data.productId) {
          const product =
            (await offlineDB.products.get(data.productId)) ||
            (await offlineDB.products.where("localId").equals(data.productId).first()) ||
            (await offlineDB.products.where("_id").equals(data.productId).first());
          if (product && product.stockMode === "limited") {
            const newStockGrams = rnd(product.stockInGrams - weightGrams);
            await offlineDB.products.update(product.localId, { 
              stockInGrams: newStockGrams < 0 ? 0 : newStockGrams,
              stock: (newStockGrams < 0 ? 0 : newStockGrams) / 1000,
              synced: 0 
            });
          }
        }
      } catch {
        // ignore stock update error
      }
      await offlineDB.sales.put(sale);
      await offlineDB.syncQueue.put({ type: "sale", localId, payload: sale, createdAt: new Date(), attempts: 0 });
      if (isCredit && data.customerName && data.customerName.toLowerCase() !== "walk-in") {
        const normalized = data.customerName.trim().toLowerCase();
        const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
        if (existing && !existing.isPaid) {
          await offlineDB.customers.update(existing.localId, {
            totalUdhar: rnd(existing.totalUdhar + total), 
            totalBusiness: rnd(existing.totalBusiness + total),
            saleIds: [...(existing.saleIds || []), localId], 
            billsCount: rnd((existing.billsCount || 0) + 1),
            lastUdharDate: nowISO, synced: 0,
          });
          await offlineDB.sales.update(localId, { customerId: existing.localId });
        } else {
          const custLocalId = genLocalId("cust");
          await offlineDB.customers.add({
            localId: custLocalId, saleIds: [localId], name: data.customerName.trim(),
            normalizedName: normalized, phone: data.phone || "", village: data.village || "",
            totalUdhar: total, totalBusiness: total, lastUdharDate: nowISO, synced: 0,
            createdAt: nowISO, billsCount: 1, isPaid: false, paidAmount: 0, wusoolHistory: [], userId: data.userId,
          });
          await offlineDB.sales.update(localId, { customerId: custLocalId });
        }
      }
    });
  } catch (e) {
    console.warn("saveSaleOffline fallback", e);
    await offlineDB.sales.put(sale);
    await offlineDB.syncQueue.put({ type: "sale", localId, payload: sale, createdAt: new Date(), attempts: 0 });
  }

  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = (await navigator.serviceWorker.ready) as SyncableRegistration;
      if (reg.sync) await reg.sync.register("sync-sales");
    } catch {
      // ignore
    }
  }
  return localId;
}

export async function syncOfflineSales(): Promise<{ synced: number }> {
  const sales = await offlineDB.sales.where("synced").equals(0).toArray();
  let synced = 0;
  for (const s of sales) {
    try {
      const res = await fetch("/api/sales", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: s.productId, 
          mixId: s.mixId,
          productName: s.productName, 
          weightGrams: s.weightGrams,
          pricePerKg: s.pricePerKg, 
          buyPricePerKg: s.buyPricePerKg,
          customerName: s.customerName, 
          paymentType: s.paymentType, 
          category: s.category,
          saleType: s.saleType,
          localId: s.localId, 
          userId: s.userId,
        }),
      });
      if (res.ok) {
        await offlineDB.sales.update(s.localId, { synced: 1 });
        await offlineDB.syncQueue.where("localId").equals(s.localId).delete();
        synced++;
      }
    } catch {
      // keep offline
    }
  }
  return { synced };
}

export async function syncAllOffline(): Promise<{ sales: number; wusool: number }> {
  if (typeof window === "undefined" || !navigator.onLine) return { sales: 0, wusool: 0 };
  
  const salesResult = await syncOfflineSales();

  let wusoolSynced = 0;
  const wusoolQueue = await offlineDB.syncQueue.where("type").equals("wusool").toArray();
  for (const q of wusoolQueue) {
    try {
      const payload = q.payload as WusoolSyncPayload;
      const cust = payload.customerLocalId ? await offlineDB.customers.get(payload.customerLocalId) : null;
      const customerName = cust?.name || "";
      if (!customerName) continue;
      const res = await fetch("/api/customers/wusool", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          amount: payload.amount,
          note: payload.note || "",
          localId: q.localId,
        }),
      });
      if (res.ok) {
        await offlineDB.syncQueue.delete(q.id as number);
        wusoolSynced++;
      }
    } catch {
      // ignore
    }
  }

  return { sales: salesResult.synced, wusool: wusoolSynced };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void syncAllOffline(); });
}