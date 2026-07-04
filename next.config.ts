import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ล็อก workspace root ไว้ที่โฟลเดอร์นี้ — กัน Turbopack เดา root ผิด
  // เมื่อมี lockfile อื่นอยู่ในไดเรกทอรีแม่ (เช่น ~/package-lock.json)
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
