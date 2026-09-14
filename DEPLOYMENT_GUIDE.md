# SE SURVEY — คู่มือ Deployment ฉบับสมบูรณ์

ขั้นตอนตั้งแต่พัฒนาบนเครื่องตัวเอง → ทดสอบ → ย้ายขึ้น VPS ใช้งานจริง

---

## ภาพรวม

```
Phase 1: พัฒนา (Local)              Phase 2: ใช้งานจริง (VPS)
┌──────────────────┐              ┌──────────────────────────┐
│ เครื่องตัวเอง       │  git push   │ VPS (Hostinger)          │
│ backend :3001    │ ──────────▶ │ Dokploy                  │
│ web     :3000    │             │  ├── Backend             │
│ mobile  emulator │             │  ├── Web App             │
└───────┬──────────┘             │  └── Supabase Self-host  │
        │                        └────────────┬─────────────┘
        ▼                                     ▼
  Supabase Cloud (ฟรี)              Supabase Self-hosted
  ใช้ตอนพัฒนา                        ใช้ตอน production
```

---

## Phase 1: พัฒนาและทดสอบบนเครื่องตัวเอง

### 1.1 สมัคร Supabase Cloud (ฟรี)

1. ไปที่ [supabase.com](https://supabase.com) → Sign Up → สร้าง Organization
2. กด **New Project** → ตั้งชื่อ เช่น `se-survey` → เลือก Region ใกล้ที่สุด (Singapore)
3. ตั้ง **Database Password** → จดไว้ (ใช้ใน DATABASE_URL)
4. รอสร้างเสร็จ (~2 นาที)

### 1.2 สร้างตารางในฐานข้อมูล

1. ใน Supabase Dashboard → ไปที่ **SQL Editor**
2. คัดลอกเนื้อหาจาก `backend/src/db/migrations/001_initial_schema.sql` → วาง → กด **Run**
3. คัดลอกเนื้อหาจาก `backend/src/db/seeds/001_seed_users.sql` → วาง → กด **Run**
4. ตรวจสอบที่ **Table Editor** → ควรเห็น 6 ตาราง (users, cases, survey_reports, ฯลฯ)

### 1.3 คัดลอก Database URL

1. ไปที่ **Settings → Database**
2. คัดลอก **Connection string (URI)** จะได้แบบนี้:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres
   ```

### 1.4 สร้าง Firebase Project

1. ไปที่ [Firebase Console](https://console.firebase.google.com) → สร้างโปรเจคใหม่
2. เปิดใช้งาน **Cloud Messaging (FCM)**
3. ไปที่ **Project Settings → Service accounts** → Generate new private key
4. จดค่า `project_id`, `client_email`, `private_key` จากไฟล์ JSON ที่ดาวน์โหลด
5. **(สำหรับ Flutter)**
   - เพิ่ม Android app → ดาวน์โหลด `google-services.json` → วางที่ `mobile/android/app/`
   - เพิ่ม iOS app → ดาวน์โหลด `GoogleService-Info.plist` → วางที่ `mobile/ios/Runner/`

### 1.5 สร้าง Google Maps API Key

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com)
2. เปิดใช้งาน APIs:
   - **Maps JavaScript API** (สำหรับ web)
   - **Maps SDK for Android** (สำหรับ mobile)
   - **Maps SDK for iOS** (สำหรับ mobile)
3. สร้าง API Key ที่ **Credentials**

### 1.6 ตั้งค่า Environment Variables

#### Backend — สร้างไฟล์ `backend/.env`

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres
JWT_SECRET=your-secret-key-at-least-32-characters-long
JWT_EXPIRES_IN=24h
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
UPLOAD_DIR=./src/uploads
MAX_FILE_SIZE=10485760
# (ไม่บังคับ) เก็บรูปบน object storage แบบ S3 แทนดิสก์ — ตั้งครบ 4 ตัวถึงเปิด (ดู backend/src/config/storage.ts)
# S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
# S3_BUCKET=sesurvey-uploads
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...
# S3_REGION=auto
```

#### Web App — สร้างไฟล์ `web/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_MAPS_KEY=your-google-maps-api-key
```

#### Flutter Mobile — แก้ไฟล์ `mobile/lib/config/api_config.dart`

```dart
class ApiConfig {
  // Android Emulator
  static const String baseUrl = 'http://10.0.2.2:3001';
  static const String socketUrl = 'http://10.0.2.2:3001';

  // iOS Simulator
  // static const String baseUrl = 'http://localhost:3001';
}
```

### 1.7 ติดตั้ง Dependencies

```bash
# Backend + Web
npm install

# Flutter
cd mobile && flutter pub get
```

### 1.8 รันและทดสอบ

```bash
# Terminal 1 — Backend API (http://localhost:3001)
cd backend && npm run dev

# Terminal 2 — Web App (http://localhost:3000)
cd web && npm run dev

# Terminal 3 — Flutter Mobile
cd mobile && flutter run
```

#### ทดสอบ Backend

```bash
# Health check
curl http://localhost:3001/health

# Login ทดสอบ
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"callcenter01","password":"password01"}'
```

#### Test Users (รหัสผ่านทุกคน: `password01`)

| Username | Role | ใช้งานที่ |
|---|---|---|
| `survey01` | surveyor | Mobile App |
| `survey02` | surveyor | Mobile App |
| `callcenter01` | callcenter | Web → /callcenter |
| `checker01` | checker | Web → /inspector |

### 1.9 ทดสอบ End-to-End

```
1. Call Center login → สร้างเคส → กดเรียกพิกัด → มอบหมายงาน
2. Surveyor เปิดแอป → เห็นงาน → กรอกข้อมูลรถ + ถ่ายรูป → ส่ง
3. Checker login → ดูรายงาน + รูปถ่าย → กรอกค่าบริการ → อนุมัติ
```

ทดสอบจนพอใจ → ไปต่อ Phase 2

---

## Phase 2: ย้ายขึ้น VPS ใช้งานจริง

### สเปค VPS ที่แนะนำ

| รายการ | ขั้นต่ำ | แนะนำ |
|---|---|---|
| CPU | 2 vCPU | 2 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB NVMe | 100 GB NVMe |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 |

### 2.1 ติดตั้ง Dokploy บน VPS

```bash
# SSH เข้า VPS
ssh root@YOUR_VPS_IP

# ติดตั้ง Dokploy (คำสั่งเดียว)
curl -sSL https://dokploy.com/install.sh | sh
```

เมื่อเสร็จจะได้ Dokploy Dashboard ที่ `http://YOUR_VPS_IP:3000`

### 2.2 ติดตั้ง Supabase Self-hosted บน VPS

```bash
# SSH เข้า VPS (ถ้ายังไม่ได้อยู่)
ssh root@YOUR_VPS_IP

# Clone Supabase Docker
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
cd /opt/supabase/docker

# ตั้งค่า
cp .env.example .env
```

#### แก้ไขไฟล์ `.env` ใน `/opt/supabase/docker/`

ค่าที่ต้องเปลี่ยน:

```env
# ตั้ง password ใหม่ (ใช้สร้าง DATABASE_URL)
POSTGRES_PASSWORD=your-strong-password-here

# ตั้ง JWT secret (ยาวอย่างน้อย 32 ตัวอักษร)
JWT_SECRET=your-super-secret-jwt-token-for-supabase

# ตั้ง Dashboard password
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=your-dashboard-password

# ตั้ง domain (ถ้ามี)
SITE_URL=https://yourdomain.com
API_EXTERNAL_URL=https://supabase.yourdomain.com
```

#### รัน Supabase

```bash
docker compose up -d
```

#### ตรวจสอบว่ารันสำเร็จ

```bash
docker compose ps
# ควรเห็น service ทั้งหมดสถานะ "running"
```

Supabase Dashboard จะอยู่ที่ `http://YOUR_VPS_IP:8000`

### 2.3 ย้ายข้อมูลจาก Cloud → Self-hosted

```bash
# บนเครื่องตัวเอง (ไม่ใช่ VPS)

# 1. Export จาก Supabase Cloud
pg_dump "postgresql://postgres:CLOUD_PASSWORD@db.PROJECT_ID.supabase.co:5432/postgres" \
  --no-owner --no-acl > backup.sql

# 2. Copy ไฟล์ไป VPS
scp backup.sql root@YOUR_VPS_IP:/tmp/

# 3. SSH เข้า VPS แล้ว Import
ssh root@YOUR_VPS_IP
psql "postgresql://postgres:YOUR_SELF_HOSTED_PASSWORD@localhost:5432/postgres" < /tmp/backup.sql
```

#### หรือถ้าไม่มี data สำคัญ — รัน migration ใหม่ได้เลย

```bash
# SSH เข้า VPS
ssh root@YOUR_VPS_IP

# รัน migration
psql "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres" \
  -f /path/to/001_initial_schema.sql

# รัน seed
psql "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres" \
  -f /path/to/001_seed_users.sql
```

### 2.4 Push Code ขึ้น GitHub

```bash
# บนเครื่องตัวเอง
cd projectSE
git add .
git commit -m "ready for production"
git remote add origin https://github.com/YOUR_USERNAME/projectSE.git
git push -u origin main
```

### 2.5 สร้าง Services ใน Dokploy

#### Service 1: Backend API

1. Dokploy Dashboard → **Create Project** → ตั้งชื่อ `se-survey`
2. **Add Service → Application**
   - Name: `backend`
   - Source: GitHub → เลือก repo `projectSE`
   - Build Path: `backend/Dockerfile`
   - Port: `3001`
3. **Environment Variables:**
   ```env
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_VPS_IP:5432/postgres
   JWT_SECRET=your-production-jwt-secret
   JWT_EXPIRES_IN=24h
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=your-firebase-client-email
   GOOGLE_MAPS_API_KEY=your-google-maps-api-key
   PORT=3001
   NODE_ENV=production
   CORS_ORIGIN=https://yourdomain.com
   UPLOAD_DIR=./uploads
   MAX_FILE_SIZE=10485760
   # เก็บรูปบน object storage (Cloudflare R2 / S3) แทน volume — ตั้งครบ 4 ตัวถึงเปิด; ไม่ตั้ง = ดิสก์ /app/uploads
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_BUCKET=sesurvey-uploads
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_REGION=auto
   # ครั้งแรกหลังเปิด: S3_MIGRATE_LOCAL=copy (ย้ายรูปเก่าใน volume ขึ้น bucket ตอนบูต) → ตรวจแล้วเปลี่ยนเป็น move → เอาออก
   ```
   ตรวจว่า bucket ใช้ได้: Open Terminal ในคอนเทนเนอร์ backend → `node dist/scripts/storageCheck.js`
4. ตั้ง **Domain**: `api.yourdomain.com` → Enable SSL

#### Service 2: Web App

1. **Add Service → Application**
   - Name: `web`
   - Source: GitHub → เลือก repo `projectSE`
   - Build Path: `web/Dockerfile`
   - Port: `3000`
2. **Environment Variables:**
   ```env
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com
   NEXT_PUBLIC_SOCKET_URL=https://api.yourdomain.com
   NEXT_PUBLIC_GOOGLE_MAPS_KEY=your-google-maps-api-key
   ```
3. ตั้ง **Domain**: `yourdomain.com` → Enable SSL

### 2.6 ตั้งค่า Domain DNS

ที่ Domain Registrar (เช่น Cloudflare, Namecheap) เพิ่ม DNS Records:

| Type | Name | Value |
|---|---|---|
| A | `yourdomain.com` | `YOUR_VPS_IP` |
| A | `api.yourdomain.com` | `YOUR_VPS_IP` |
| A | `supabase.yourdomain.com` | `YOUR_VPS_IP` (ถ้าต้องการเข้า dashboard) |

### 2.7 Deploy

1. กด **Deploy** ใน Dokploy → รอ build เสร็จ
2. ทดสอบ:
   ```bash
   # Health check
   curl https://api.yourdomain.com/health

   # เปิดเว็บ
   # https://yourdomain.com → หน้า Login
   ```

### 2.8 อัพเดท Flutter สำหรับ Production

แก้ไฟล์ `mobile/lib/config/api_config.dart`:

```dart
class ApiConfig {
  static const String baseUrl = 'https://api.yourdomain.com';
  static const String socketUrl = 'https://api.yourdomain.com';
}
```

Build APK:

```bash
cd mobile && flutter build apk --release
# ไฟล์อยู่ที่ build/app/outputs/flutter-apk/app-release.apk
```

---

## Phase 3: บำรุงรักษา

### อัพเดทโค้ด

```bash
# แก้โค้ดบนเครื่องตัวเอง → push
git add . && git commit -m "fix: ..." && git push

# Dokploy จะ auto deploy (ถ้าตั้ง auto deploy ไว้)
# หรือกด Deploy ใน Dokploy Dashboard
```

### Backup ฐานข้อมูล

```bash
# SSH เข้า VPS
ssh root@YOUR_VPS_IP

# Export ฐานข้อมูล
pg_dump "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres" > backup_$(date +%Y%m%d).sql
```

### ดู Logs

```bash
# ดู Supabase logs
cd /opt/supabase/docker && docker compose logs -f

# ดู App logs ผ่าน Dokploy Dashboard → Service → Logs
```

### อัพเดท Supabase Self-hosted

```bash
cd /opt/supabase/docker
git pull
docker compose pull
docker compose up -d
```

---

## Checklist สรุป

### Phase 1 — พัฒนา (Local)

- [ ] สมัคร Supabase Cloud → สร้าง project
- [ ] รัน SQL migration + seed
- [ ] สร้าง Firebase project → เปิด FCM
- [ ] สร้าง Google Maps API Key
- [ ] ตั้งค่า `.env` ทุกตัว
- [ ] `npm install` + `flutter pub get`
- [ ] รัน backend + web + mobile → ทดสอบจนพอใจ

### Phase 2 — Production (VPS)

- [ ] ติดตั้ง Dokploy บน VPS
- [ ] ติดตั้ง Supabase Self-hosted บน VPS
- [ ] ย้ายข้อมูล (pg_dump → psql) หรือรัน migration ใหม่
- [ ] Push code ขึ้น GitHub
- [ ] สร้าง services ใน Dokploy (Backend + Web)
- [ ] ตั้งค่า Domain + DNS + SSL
- [ ] Deploy + ทดสอบ
- [ ] Build Flutter APK สำหรับแจกจ่าย
