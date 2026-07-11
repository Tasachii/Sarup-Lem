import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ล็อก workspace root ไว้ที่โฟลเดอร์นี้ — กัน Turbopack เดา root ผิด
  // เมื่อมี lockfile อื่นอยู่ในไดเรกทอรีแม่ (เช่น ~/package-lock.json)
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
