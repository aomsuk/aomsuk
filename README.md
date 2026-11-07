# AOMSUK – คู่มือตั้งค่า Firebase

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าเปิดแอป (ล็อกอินแล้ว → ติดตาม, ยังไม่ล็อกอิน → login) |
| `login.html` / `register.html` | เข้าสู่ระบบ / สมัครสมาชิก / ลืมรหัสผ่าน |
| `dashboard.html` | หน้าติดตาม |
| `add-goal.html` | เพิ่มเป้าหมาย |
| `chat.html` | แชทบอทจัดตารางออม |
| `settings.html` | ตั้งค่า (โปรไฟล์ การแจ้งเตือน รหัสผ่าน ลบบัญชี) |
| `app.js` | ระบบกลาง: Firebase Auth + Firestore + กระดิ่งแจ้งเตือน |
| `firebase-config.js` | **ต้องวาง config ของคุณที่นี่** |
| `firestore.rules` | กฎความปลอดภัยของฐานข้อมูล |

> ลบไฟล์ `auth.js` เวอร์ชันเก่าทิ้งได้เลย ไม่ได้ใช้แล้ว

---

## ขั้นตอนตั้งค่า (ประมาณ 10 นาที)

### 1. สร้างโปรเจกต์ Firebase
1. เข้า https://console.firebase.google.com แล้วกด **Create a project / เพิ่มโปรเจกต์**
2. ตั้งชื่อ เช่น `aomsuk` → กดถัดไป (ปิด Google Analytics ได้)

### 2. เพิ่มเว็บแอปและคัดลอก config
1. หน้า Project Overview กดไอคอน **`</>` (Web)**
2. ตั้งชื่อแอป เช่น `aomsuk-web` → **Register app** (ไม่ต้องติ๊ก Hosting ตอนนี้ก็ได้)
3. จะเห็นโค้ด `const firebaseConfig = { ... }` ให้คัดลอกค่าข้างในไปวางใน **`firebase-config.js`** แทนค่า `YOUR_...` ทั้งหมด

```js
window.FIREBASE_CONFIG = {
    apiKey: "AIza....",
    authDomain: "aomsuk-xxxx.firebaseapp.com",
    projectId: "aomsuk-xxxx",
    storageBucket: "aomsuk-xxxx.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
};
```

### 3. เปิดระบบล็อกอินด้วยอีเมล
1. เมนูซ้าย **Build → Authentication → Get started**
2. แท็บ **Sign-in method** → เลือก **Email/Password** → เปิด **Enable** → Save
3. (แนะนำ) แท็บ **Templates** → กดไอคอนดินสอ → เปลี่ยน **Template language** เป็นภาษาไทย เพื่อให้อีเมลรีเซ็ตรหัสผ่านเป็นภาษาไทย

### 4. สร้างฐานข้อมูล Firestore
1. เมนูซ้าย **Build → Firestore Database → Create database**
2. เลือก Location ใกล้ไทย เช่น **asia-southeast1 (Singapore)** → เลือก **Start in production mode** → Create
3. แท็บ **Rules** → ลบของเดิม แล้ววางเนื้อหาจากไฟล์ **`firestore.rules`** → กด **Publish**

### 5. เปิดเว็บผ่านเซิร์ฟเวอร์ (ห้ามดับเบิลคลิกไฟล์)
Firebase ต้องเปิดผ่าน `http://` หรือ `https://` ไม่ใช่ `file://`

- **ทดสอบในเครื่อง:** ใช้ VS Code ติดตั้งส่วนขยาย **Live Server** → คลิกขวา `index.html` → **Open with Live Server**
- **เผยแพร่ออนไลน์ (ฟรี) ด้วย Firebase Hosting:**
  ```bash
  npm install -g firebase-tools
  firebase login
  firebase init hosting      # เลือกโปรเจกต์, public directory ใส่ .  , ตอบ No กับ single-page app
  firebase deploy
  ```
  จะได้ลิงก์ `https://aomsuk-xxxx.web.app`

---

## โครงสร้างฐานข้อมูล (Firestore)

```
users/{uid}                     ← โปรไฟล์ { name, email, createdAt, settings{}, interests[] }
  ├─ goals/{id}                 ← แผนการออมจากแชทบอท { title, target, frequency, startDate, endDate, schedule[] }
  ├─ wishlist/{id}              ← เป้าหมายสิ่งที่อยากซื้อ { emoji, name, price }
  └─ notifications/{id}         ← การแจ้งเตือน { type, title, body, link, read, createdAt }
```

ผู้ใช้แต่ละคนเห็นเฉพาะข้อมูลของตัวเอง (บังคับด้วย `firestore.rules`)

## การแจ้งเตือน (กระดิ่งมุมขวาบน)

ระบบสร้างให้อัตโนมัติ และเปิด/ปิดแต่ละประเภทได้ในหน้าตั้งค่า:

| ประเภท | เมื่อไหร่ |
|---|---|
| 🐷 ถึงวันออม | วันนี้มียอดที่ต้องออม (ติ๊กแล้วจะอ่านให้อัตโนมัติ) |
| 😔 พลาดการออม | มีวันที่ยังไม่ได้ออม ย้อนหลัง 3 วัน |
| 🏆 ถึงเป้าหมาย | ออมครบตามแผน |
| 🛍️ ซื้อของได้แล้ว | เงินออมพอซื้อสิ่งที่อยากได้ |
| 📅 / 👋 | สร้างแผนใหม่ / ยินดีต้อนรับสมาชิกใหม่ |

"แจ้งเตือนผ่านเบราว์เซอร์" จะเด้งบนหน้าจอเมื่อเปิดเว็บอยู่ ถ้าต้องการแจ้งเตือนตอนปิดเว็บ ต้องใช้ Firebase Cloud Messaging + Service Worker เพิ่มเติม

## ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| ขึ้น "ยังไม่ได้ตั้งค่า Firebase" | ยังไม่ได้แก้ `firebase-config.js` |
| "ยังไม่ได้เปิดใช้การล็อกอินด้วยอีเมล" | ทำขั้นตอนที่ 3 |
| "ไม่มีสิทธิ์เข้าถึงฐานข้อมูล" | ยังไม่ได้ Publish rules ในขั้นตอนที่ 4 |
| หน้าโหลดไม่ขึ้น / ค้าง | เปิดผ่าน Live Server หรือ Hosting แทน `file://` และตรวจอินเทอร์เน็ต |
