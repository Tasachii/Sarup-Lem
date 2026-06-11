import type { Metadata } from "next";
import { Trirong, Anuphan } from "next/font/google";
import "./globals.css";

const trirong = Trirong({
  variable: "--font-trirong",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "สรุปเล่ม — ผู้ช่วยสรุปหนังสือด้วย AI",
  description:
    "โยนไฟล์ PDF, DOCX, TXT เข้ามา แล้วให้ AI สรุปเนื้อหาให้ครบถ้วน ไม่ตกหล่น",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${trirong.variable} ${anuphan.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
