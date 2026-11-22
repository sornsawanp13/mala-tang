# ร้านหม่าล่าทั่ง

เว็บไซต์ React + Vite + Supabase สำหรับเลือกวัตถุดิบ คำนวณราคา และเข้าระบบหลังร้าน

## สถานะ
- ใช้งานได้: ดึงเมนูจาก Supabase, เลือกน้ำหนัก, คำนวณราคา, เลือกน้ำซุป/ความเผ็ด, ล็อกอินหลังร้าน, ดูและอัปเดตสถานะออเดอร์ (เฉพาะ Admin)
- **ยังไม่เปิดใช้งาน:** การบันทึกออเดอร์ลูกค้า, QR PromptPay, อัปโหลดสลิป, การแก้ไขวัตถุดิบผ่านหน้าเว็บ และรายงานยอดขาย ต้องพัฒนาฝั่งเซิร์ฟเวอร์อย่างปลอดภัยก่อน

## ตั้งค่า Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` (Publishable key)
- ห้ามใส่ Supabase Secret key หรือ service_role key ในโค้ดหรือ GitHub

## พัฒนาในเครื่อง
`npm install` แล้ว `npm run dev` โดยสร้างไฟล์ `.env.local` จาก `.env.example`
