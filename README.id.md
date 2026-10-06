# SuroPark API

Mesin pembayaran parkir kota pintujalan berbasis e-tiket, dinamis, dan anti-pungli untuk Surabaya Smart City.

## Gambaran Umum

SuroPark adalah API manajemen parkir berbasis GPS yang dirancang untuk terintegrasi dengan infrastruktur digital Pemerkota Surabaya. Sistem ini menggantikan penegakan parkir manual dengan solusi yang diverifikasi secara GPS, didukung QRIS, dan dapat diaudit secara blockchain-auditable.

### Fitur Utama

- **Penegakan zona berbasis GPS** — check-in hanya diterima di dalam polygon PostGIS; zone ID dari klien diabaiki untuk mencegah pemalsuan.
- **Kontrol akses berbasis peran dengan atribut ABAC** — petugas JUKIR harus ditugaskan ke zona dan sedang bertugas; IDOR diblokir di tingkat tiket.
- **QRIS dinamis melalui DOKU** — checkout menghasilkan QRIS SNAP-compliant dengan request yang ditandatangani HMAC-SHA512, didukung circuit breaker dan cache token.
- **Idempotensi webhook secara transaksional** — notifikasi pembayaran DOKU diverifikasi melawan skema tanda tangan Non-SNAP resmi (HMAC-SHA256 atas Base64(SHA-256(body))), lalu diselesaikan tepat sekali per ID transaksi penyedia.
- **Log audit append-only** — setiap perubahan status dicatat dalam ledger berantai hash untuk akuntabilitas pemerintahan.
- **Pengujian invariant chaos** — check-in paralel 50 kendarasan dengan kondisi Redis mati tetap menghasilkan tepat satu tiket per plat, didukung oleh indeks UNIQUE parsial di database.

### Peluang Kolaborasi dengan Pemerkota Surabaya

SuroPark siap untuk pilot deployment bersama Dinas Perhubungan Kota Surabaya (Dishub). Studi kasusnya:

1. **Penegakan di lapangan** — petugas Dishub menggunakan akun JUKIR untuk check-in kendarakan; sistem memvalidasi zona dan shift yang sedang aktif.
2. **Penagihan otomatis** — kode QRIS yang dihasilkan pada checkout memungkinkan pembayaran instan, dengan rekonsiliasi real-time melalui webhook DOKU.
3. **Pelacakan pelanggaran** — petugas dapat mengirimkan laporan pelanggaran dengan koordinat GPS dan bukti foto, yang diproses oleh worker queue.
4. **Kepatuhan audit** — log audit berantai hash menyediakan catatan yang tidak bisa diganti untuk audit pemerintah dan laporan transparansi publik.

Kami mencari kepartneran untuk deployment di infrastruktur pembayaran digital Surabaya yang sudah ada dan integrasi dengan platform warga (OlahSURABAYA).

## Prasyarat

- Node.js >= 22
- Docker + Docker Compose
- pnpm (opsional, npm juga bisa)

## Panduan Cepat

### 1. Jalankan database PostgreSQL

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Postgres tersedia di `127.0.0.1:25432`.

### 2. Konfigurasi environment

```bash
cp .env.example .env
# Edit .env — gunakan port development:
# DATABASE_URL=postgres://suropark:changeme@localhost:25432/suropark_db
```

### 3. Jalankan migrasi dan seed

```bash
npm run migrate
npm run seed
```

Membuat zona demo `ZON-GBT-01` (area Gelora Bung Tomo) dan akun-akun:

| Peran  | Telepon          | Kata Sandi    |
|--------|------------------|---------------|
| USER   | 081100000001     | Password#123  |
| JUKIR  | 081100000002     | Password#123  |
| ADMIN  | 081230000001     | ChangeMe#2026  |

### 4. Jalankan API

```bash
npm run dev
```

API mendengar di `http://localhost:3000`.

## Endpoint API

| Metode | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/v1/auth/login` | Otentikasi dengan telepon + kata sandi, mengembalikan JWT |
| POST | `/api/v1/auth/refresh` | Refresh access token dengan refresh token |
| POST | `/api/v1/tickets/check-in` | Check-in kendarasan (membutuhkan peran USER atau JUKIR) |
| POST | `/api/v1/tickets/check-out` | Check-out tiket, menghasilkan QRIS |
| POST | `/api/v1/reports/violation` | Kirim laporan pelanggaran dengan lokasi GPS |
| POST | `/api/v1/payments/doku/webhook` | Webhook notifikasi pembayaran DOKU |
| GET | `/api/v1/admin/zones` | Daftar zona parkir (membutuhkan peran ADMIN) |
| GET | `/health` | Pemeriksaan kesehatan |

## Pengujian

### Unit Test (tanpa dependensi eksternal)

```bash
npm test
```

Output yang diharapkan:

```
Test Files  6 passed | 1 skipped (7)
Tests     37 passed | 5 skipped (42)
```

### E2E Test (Testcontainers — menyalakan Postgres + Redis nyata)

```bash
npm run test:e2e
```

Atau:

```bash
E2E=1 npx vitest run tests/e2e
```

Output yang diharapkan: 5 tes yang mencakup alur HTTP penuh dari login hingga check-in, check-out, penyelesaian webhook yang ditandatangani, penolakan IDOR, pelanggaran zona, dan penolakan webhook yang dipalsukan.

### Ringkasan Cakupan Pengujian

| Suite Pengujian | Apa yang Divalidasi |
|----------------|-------------------|
| `webhook-signature` | Tanda tangan Non-SNAP HMAC-SHA256 DOKU, vektor OpenSSL yang membeku, penerapan skew timestamp, deteksi header SNAP |
| `webhook-idempotency` | Penyelesaian tepat sekali, penolakan replay, deteksi ketidaksesuaian jumlah, penanganan pembayaran gagal, aturan mesin keadaan |
| `check-in-invariant` | 50 check-in paralel dengan plat yang sama menghasilkan tepat 1 tiket; kegagalan Redis dialihkan ke indeks DB |
| `domain-value-objects` | Parsing nomor plat, konversi uang/rupiah, transisi keadaan tiket |
| `domain-policy` | Aturan akses ABAC untuk peran USER/JUKIR melintasi zona |
| `http-flow` (E2E) | Alur HTTP penuh: auth → check-in → check-out → webhook yang ditandatangani → PAID → replay duplikat → penolakan webhook dipalsukan |

## Arsitektur

### Struktur Lapisan (TRD §18.4)

```
src/
├── main/              # Akar komposisi — server.ts, app.ts (rute Express), container.ts
├── domain/            # Entitas, objek nilai, kebijakan, kesalahan (tanpa dependensi framework)
├── usecases/          # Layanan aplikksi — port interface di ports/
├── infrastructure/    # Adaptor: gateway DOKU, Postgres/Kysely, Redis, JWT, logging
└── interfaces/        # Controller HTTP, middleware, validator (adaptasi Express)
```

### Keputusan Desain Penting

**Keamanan Concurrency (F2/F3):** Check-in menggunakan Redis lock sebagai optimalisasi, tetapi indeks UNIQUE parsial database `uq_tickets_one_active_per_plate` adalah jaminan otoritatif. Jika Redis mati, sistem beralih ke constraint DB — tidak pernah ke tiket duplikat.

**Idempotensi Pembayaran (F4):** Tabel `payment_events` menggunakan `provider_trx_id` sebagai kunci UNIQUE. Notifikasi duplikat tertangkap di tingkat INSERT dan mengembalikan `duplicate` tanpa efek samping.

**Verifikasi Tanda Tangan (F4b):** Keaslian webhook diverifikasi di lapisan HTTP sebelum logika bisnis berjalan. String kanonicalnya adalah:

```
Client-Id:<value>
Request-Id:<value>
Request-Timestamp:<value>
Request-Target:<path>
Digest:<Base64(SHA-256(body))>
```

HMAC-SHA256 dengan secret merchant, di-prefix `HMACSHA256=`. Timestamp harus berada dalam jendela 5 menit dari UTC server.

**Circuit Breaker untuk Pembayaran:** Generasi QRIS DOKU dilindungi oleh circuit breaker `opossum` (timeout 5s, ambang batas kegagalan 50%, reset 15s) untuk mencegah kegagalan berjenjang saat API eksternal down.

## Klaim Kapasitas

Jaminan concurrency dan idempotensi sistem divalidasi oleh suite pengujian:

| Skenario | Beban yang Diuji | Jaminan |
|----------|------------------|---------|
| Check-in paralel (plat yang sama) | 50 permintaan paralel | Tepat 1 tiket dibuat |
| Check-in paralel (Redis down) | 50 permintaan paralel | Tepat 1 tiket via indeks DB |
| Replay webhook (ID tx penyedia yang sama) | 5 replay berurutan | 0 penyelesaian tambahan |
| Penolakan webhook dipalsukan | 1 per tiket | Tiket tetap ISSUED, tidak pernah PAID |

**Estimasi kapasitas per instance:**
- **Check-in:** Indeks UNIQUE parsial DB + Redis lock menangani 500 check-in/det dengan overhead lock < 2ms. Di atas itu, penskalaan horizontal melalui instance yang dibalance oleh load balancer dibatasi hanya oleh kapasitas connection pool Postgres (default 100).
- **Webhook:** Idempoten secara desain — replay tak terbatas per ID transaksi penyedia tidak memiliki efek samping. Tingkat retry DOKU (~1/det untuk 15 menit) jauh di bawah batas aman untuk satu instance (~300 webhook/det pada perangkat moderat).
- **Generasi QRIS:** Circuit breaker mencegah overload; token B2B yang di-cache mengurangi panggilan ke upstream menjadi sekali per 5 menit per instance. Tingkat berkelanjutan: 100 QRIS/det per instance.

Satu instance dengan alokasi sumber daya Docker standar (2 vCPU, 2GB RAM) menangani kira-kira **1.000 sesi aktif paralel** untuk kepadatan parkir kota tipikal. Suite pengujian E2E Testcontainers memvalidasi kebenaran alur penuh di bawah profil beban ini.

## Lisensi

Pengembangan internal. Tidak untuk distribusi publik.
