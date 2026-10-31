import Dexie, { type Table } from "dexie";

export type WusoolHistoryEntry = { amount: number; date: string; note?: string };
export type WusoolSyncPayload = { amount: number; note?: string; date: string; customerLocalId?: string };
export type SaleCategory = "dryfruit" | "pansar" | "masala_raw" | "masala_mix" | "other";
export type SaleType = "loose" | "mix";

export interface OfflineProduct {
  localId: string; 
  _id?: string; 
  name: string; 
  category: SaleCategory;
  pricePerKg: number;
  buyPricePerKg: number;
  stockInGrams: number;
  stockMode: "limited" | "unlimited"; 
  userId: string;
  synced: number; 
  createdAt: string; 
  lastSyncedAt?: string;
  // compat - optional for old Asad Mobile code and product page
  buyPriceAvg?: number;
  sellPrice?: number;
  buyPrice?: number;
  stock?: number;
}

export interface OfflineSale {
  localId: string; 
  _id?: string; 
  productId?: string;
  mixId?: string;
  productName: string;
  category: SaleCategory; 
  saleType: SaleType;
  weightGrams: number;
  pricePerKg: number;
  buyPricePerKg: number;
  quantity: number;
  total: number; 
  profit: number; 
  customerName: string;
  paymentType: "cash" | "credit"; 
  status: "paid" | "pending"; 
  userId: string;
  createdAt: string; 
  synced: number; 
  customerId?: string;
  // compat
  buyPriceAvg?: number;
  sellPrice?: number;
}

export interface OfflineCustomer {
  localId: string; _id?: string; saleIds: string[]; name: string; normalizedName: string;
  phone?: string; village?: string; totalUdhar: number; totalBusiness: number;
  lastUdharDate?: string; lastWusoolDate?: string; paidAt?: string; synced: number;
  createdAt?: string; billsCount: number; isPaid?: boolean; paidAmount?: number;
  wusoolHistory?: WusoolHistoryEntry[]; userId?: string;
}

export type OfflinePayload = OfflineSale | OfflineProduct | OfflineCustomer | WusoolSyncPayload;

export interface SyncQueueItem {
  id?: number; 
  type: "sale" | "product" | "customer" | "wusool";
  localId: string; 
  payload: OfflinePayload; 
  createdAt: Date; 
  attempts: number;
}

type LegacyProductForMigration = {
  buyPrice?: number;
  buyPriceAvg?: number;
  buyPricePerKg?: number;
  sellPrice?: number;
  pricePerKg?: number;
  stock?: number;
  stockInGrams?: number;
};

function rnd(n: number): number { 
  return Math.round(n || 0); 
}

export class OfflineDB extends Dexie {
  products!: Table<OfflineProduct, string>;
  sales!: Table<OfflineSale, string>;
  customers!: Table<OfflineCustomer, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super("ShahsawarMasalaOfflineV1");
    
    this.version(8).stores({
      products: "localId, _id, userId, synced, name, category, createdAt",
      sales: "localId, _id, productId, mixId, userId, synced, createdAt, customerName, status, category, saleType, paymentType",
      customers: "localId, _id, name, normalizedName, userId, synced, totalUdhar, isPaid, createdAt",
      syncQueue: "++id, type, localId, createdAt",
    }).upgrade((tx) => {
      return tx.table("products").toCollection().modify((p: LegacyProductForMigration) => {
        if (p.buyPrice && !p.buyPriceAvg) p.buyPriceAvg = rnd(p.buyPrice);
        if (p.buyPriceAvg && !p.buyPrice) p.buyPrice = rnd(p.buyPriceAvg);
        if (p.buyPriceAvg && !p.buyPricePerKg) p.buyPricePerKg = rnd(p.buyPriceAvg);
        if (p.sellPrice && !p.pricePerKg) p.pricePerKg = rnd(p.sellPrice);
        if (p.stock && !p.stockInGrams) p.stockInGrams = rnd(p.stock * 1000);
      });
    });
  }
}

export const offlineDB = new OfflineDB();
export const db = offlineDB;

export function calcProfit(pricePerKg: number, buyPricePerKg: number, weightGrams: number): number {
  const weightKg = weightGrams / 1000;
  return rnd((rnd(pricePerKg) - rnd(buyPricePerKg)) * weightKg);
}

export function calcTotal(pricePerKg: number, weightGrams: number): number {
  const weightKg = weightGrams / 1000;
  return rnd(rnd(pricePerKg) * weightKg);
}

export async function upsertOfflineCustomer(sale: OfflineSale, village = "", phone = ""): Promise<string | null> {
  const name = (sale.customerName || "").trim();
  if (!name || name.toLowerCase() === "walk-in") return null;
  const normalized = name.toLowerCase();
  const existing = await offlineDB.customers.where("normalizedName").equals(normalized).first();
  if (existing && !existing.isPaid) {
    await offlineDB.customers.update(existing.localId, {
      totalUdhar: rnd(existing.totalUdhar + sale.total),
      totalBusiness: rnd(existing.totalBusiness + sale.total),
      saleIds: [...(existing.saleIds || []), sale.localId],
      billsCount: (existing.billsCount || 1) + 1,
      lastUdharDate: new Date().toISOString(),
      synced: 0,
    });
    return existing.localId;
  } else {
    const localId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await offlineDB.customers.add({
      localId, saleIds: [sale.localId], name, normalizedName: normalized,
      phone, village, totalUdhar: rnd(sale.total), totalBusiness: rnd(sale.total),
      lastUdharDate: new Date().toISOString(), synced: 0,
      createdAt: new Date().toISOString(), billsCount: 1, isPaid: false, paidAmount: 0,
      wusoolHistory: [], userId: sale.userId,
    });
    return localId;
  }
}

export async function addOfflineWusool(customerLocalId: string, amount: number, note = ""): Promise<WusoolHistoryEntry | null> {
  const customer = await offlineDB.customers.get(customerLocalId);
  if (!customer) return null;
  const paid = rnd(amount);
  const newUdhar = rnd(customer.totalUdhar - paid);
  const entry: WusoolHistoryEntry = { amount: paid, date: new Date().toISOString(), note };
  if (newUdhar <= 0) {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: 0, isPaid: true, paidAmount: customer.totalBusiness,
      lastWusoolDate: entry.date, wusoolHistory: [...(customer.wusoolHistory || []), entry], synced: 0,
    });
  } else {
    await offlineDB.customers.update(customerLocalId, {
      totalUdhar: newUdhar, paidAmount: rnd((customer.paidAmount || 0) + paid),
      lastWusoolDate: entry.date, wusoolHistory: [...(customer.wusoolHistory || []), entry], synced: 0,
    });
  }
  await offlineDB.syncQueue.add({
    type: "wusool", localId: customerLocalId,
    payload: { amount: paid, note, date: entry.date, customerLocalId },
    createdAt: new Date(), attempts: 0,
  });
  return entry;
}