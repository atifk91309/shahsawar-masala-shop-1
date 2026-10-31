import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-[#fff7ed] p-6 text-center">
      <Image src="/logo.png" unoptimized alt="Shahsawar Masala" width={80} height={80} className="w-20 h-20 rounded-full border-2 border-[#b45309] mb-4 bg-white" />
      <h1 className="text-xl font-bold">🌶️ Shahsawar Masala</h1>
      <p className="text-[#b45309] text-sm font-bold">شہسوار مصالحہ شاپ</p>
      <p className="text-gray-600 text-sm font-medium">Kajoor • Kishmish • Pansar • Mong Pali • Haldi • Mirch</p>
      <p className="text-gray-500 text-[12px] mt-3">You are offline. Your masala data is safe in Ismaila.</p>
      <p className="text-[11px] text-gray-400 mt-1">Sales by grams, Stock & Khata work offline • Auto-sync when online</p>
      <div className="flex gap-2 mt-5">
        <Link href="/" className="bg-[#b45309] text-white px-4 py-2 rounded-xl text-sm font-bold">Home</Link>
        <Link href="/dashboard" className="bg-white border px-4 py-2 rounded-xl text-sm">Dashboard</Link>
      </div>
      <p className="text-[10px] text-gray-400 mt-6">Shahsawar Masala • Ismaila Swabi • Offline V1 • Grams System</p>
    </div>
  );
}