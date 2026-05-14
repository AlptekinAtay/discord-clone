[README.md](https://github.com/user-attachments/files/27780347/README.md)
# Discord Clone 🎮

Discord'dan ilham alınarak geliştirilen, gerçek zamanlı mesajlaşma ve sesli/görüntülü iletişim özellikleri sunan **lite** bir uygulama.

> ⚠️ **Feragatname:** Bu proje tamamen eğitim amaçlı bir çalışmadır. Discord Inc. ile resmi bir bağı yoktur ve ticari amaç gütmemektedir.

---

## 📋 İçindekiler

- [Proje Hakkında](#proje-hakkında)
- [Özellikler](#özellikler)
- [Teknoloji Yığını](#teknoloji-yığını)
- [Proje Yapısı](#proje-yapısı)
- [Kurulum](#kurulum)
- [Ortam Değişkenleri](#ortam-değişkenleri)
- [Katkıda Bulunma](#katkıda-bulunma)

---

## 📌 Proje Hakkında

Bu proje, Discord'un temel işlevlerini yeniden üreten bir web uygulamasıdır. TypeScript ile geliştirilmiş olup monorepo mimarisini benimsemektedir. Gerçek zamanlı iletişim için WebSocket, sesli/görüntülü görüşmeler için WebRTC teknolojileri kullanılmaktadır.

---

## ✨ Özellikler

- 💬 **Gerçek Zamanlı Mesajlaşma** — WebSocket üzerinden anlık mesaj iletimi
- 🔐 **JWT Kimlik Doğrulama** — Güvenli kullanıcı oturumu yönetimi
- 🎙️ **Sesli/Görüntülü Görüşme** — WebRTC (mediasoup) tabanlı SFU mimarisi
- 🛡️ **Özel Erişim Kontrolü** — Whitelist tabanlı yetkilendirme sistemi
- 🗄️ **Veritabanı Desteği** — Prisma ORM ile SQLite entegrasyonu
- ⚡ **Hızlı Geliştirme** — Vite ile optimize edilmiş frontend build süreci

---

## 🛠️ Teknoloji Yığını

### Backend
| Teknoloji | Amaç |
|-----------|------|
| Node.js / TypeScript | Uygulama sunucusu |
| WebSocket | Gerçek zamanlı iletişim |
| mediasoup / WebRTC | Sesli & görüntülü görüşme |
| Prisma ORM | Veritabanı yönetimi |
| SQLite | Yerel veritabanı |
| JWT | Kimlik doğrulama |

### Frontend
| Teknoloji | Amaç |
|-----------|------|
| TypeScript | Uygulama dili |
| Vite | Build aracı & geliştirme sunucusu |
| CSS | Stil |

### Araçlar
| Teknoloji | Amaç |
|-----------|------|
| Bun | Paket yöneticisi & runtime |
| Monorepo | `apps/*` ve `packages/*` workspace yapısı |

---

## 📁 Proje Yapısı

```
discord-clone/
├── apps/
│   ├── frontend/           # Vite + TypeScript istemci uygulaması
│   └── backend/            # API sunucusu, WebSocket ve mediasoup
├── packages/               # Paylaşılan paketler / kütüphaneler
├── .env.example            # Ortam değişkenleri şablonu
├── package.json            # Workspace tanımları
└── bun.lock                # Bun kilit dosyası
```

---

## 🚀 Kurulum

### Gereksinimler

- [Bun](https://bun.sh) >= 1.0
- Node.js >= 18

### Adımlar

1. **Repoyu klonlayın:**
   ```bash
   git clone https://github.com/AlptekinAtay/discord-clone.git
   cd discord-clone
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   bun install
   ```

3. **Ortam değişkenlerini ayarlayın:**
   ```bash
   cp .env.example .env
   # .env dosyasını kendi değerlerinizle düzenleyin
   ```

4. **Veritabanını oluşturun:**
   ```bash
   # Repo kökündeyken backend klasörüne geç
   cd apps/backend
   bunx prisma migrate dev
   # Tekrar repo köküne dön
   cd ../..
   ```

5. **Uygulamayı başlatın** (repo kökünden):
   ```bash
   bun run dev
   ```

---

## 🔧 Ortam Değişkenleri

`.env.example` dosyasını kopyalayarak `.env` oluşturun ve aşağıdaki değerleri doldurun:

### Backend

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `PORT` | Backend sunucu portu | `3000` |
| `WS_PORT` | WebSocket sunucu portu | `8080` |
| `JWT_SECRET` | JWT imzalama anahtarı | `your_secret_key_here` |
| `DATABASE_URL` | Prisma veritabanı bağlantısı | `file:./prisma/dev.db` |
| `ANNOUNCED_IP` | VPS/sunucu IP adresi (WebRTC) | `your_vps_ip` |
| `RTC_MIN_PORT` | WebRTC minimum port aralığı | `40000` |
| `RTC_MAX_PORT` | WebRTC maksimum port aralığı | `40100` |
| `PUBLIC_URL` | Backend erişim URL'i | `http://your_vps_ip:3000` |

### Frontend

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `VITE_API_URL` | Backend API URL'i | `http://your_vps_ip:3000` |
| `VITE_WS_URL` | WebSocket bağlantı URL'i | `ws://your_vps_ip:8080` |

> ⚠️ **Not:** Gerçek ortam değişkenlerini asla Git'e commit etmeyin. `.env` dosyası `.gitignore` tarafından korunmaktadır.

---

## 🤝 Katkıda Bulunma

1. Bu repoyu fork edin
2. Yeni bir branch oluşturun (`git checkout -b feature/yeni-ozellik`)
3. Değişikliklerinizi commit edin (`git commit -m 'feat: yeni özellik eklendi'`)
4. Branch'inizi push edin (`git push origin feature/yeni-ozellik`)
5. Pull Request açın

---

## 👤 Geliştirici

**Alptekin Atay**

- GitHub: [@AlptekinAtay](https://github.com/AlptekinAtay)

---

*Discord-Clone — Discord'dan ilham alınmış, eğitim amaçlı geliştirilmiş bir uygulama. Alptekin Atay tarafından yapılmıştır.*
