/* =====================================================================
   AOMSUK - app.js  (ใช้ร่วมกันทุกหน้า)
   - ระบบบัญชีผู้ใช้: Firebase Authentication (อีเมล + รหัสผ่าน)
   - ฐานข้อมูล: Cloud Firestore
       users/{uid}                    : { name, email, createdAt, settings, interests[] }
       users/{uid}/goals/{id}         : แผนการออมจากแชทบอท (schedule[])
       users/{uid}/wishlist/{id}      : เป้าหมายสิ่งที่อยากซื้อ { emoji, name, price }
       users/{uid}/notifications/{id} : การแจ้งเตือน { type, title, body, link, read, createdAt }
   - กระดิ่งแจ้งเตือนมุมขวาบน + เมนูผู้ใช้ในแถบด้านข้าง
   วิธีใช้ในแต่ละหน้า (ใส่ใน <head>):
       <script src="firebase-config.js"></script>
       <script src="app.js"></script>
   แล้วในสคริปต์ของหน้า:  AOMSUK.onReady(render); AOMSUK.onChange(render);
   ===================================================================== */
(function () {
    const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const PUBLIC = /^(index|login|register)\.html$/.test(page);

    const DEFAULT_SETTINGS = { notifyDue: true, notifyMissed: true, notifyGoal: true, notifyWish: true, browserNotif: false };

    // ---------- helpers ----------
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = n => String(n).padStart(2, '0');
    const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const money = n => (+n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const clean = o => JSON.parse(JSON.stringify(o));
    const savedOf = g => (g.schedule || []).reduce((s, it) => s + (it.saved ? +it.amount : 0), 0);
    const nowISO = () => new Date().toISOString();

    const ERR = {
        'auth/email-already-in-use': ['อีเมลนี้สมัครสมาชิกไว้แล้ว ลองเข้าสู่ระบบแทนนะ', 'email'],
        'auth/invalid-email': ['รูปแบบอีเมลไม่ถูกต้อง', 'email'],
        'auth/missing-email': ['กรุณากรอกอีเมล', 'email'],
        'auth/weak-password': ['รหัสผ่านอ่อนเกินไป (อย่างน้อย 6 ตัว)', 'password'],
        'auth/missing-password': ['กรุณากรอกรหัสผ่าน', 'password'],
        'auth/user-not-found': ['ไม่พบบัญชีนี้ กรุณาสมัครสมาชิกก่อน', 'email'],
        'auth/wrong-password': ['รหัสผ่านไม่ถูกต้อง', 'password'],
        'auth/invalid-credential': ['อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'password'],
        'auth/invalid-login-credentials': ['อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'password'],
        'auth/too-many-requests': ['ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่', null],
        'auth/network-request-failed': ['เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง', null],
        'auth/requires-recent-login': ['เพื่อความปลอดภัย กรุณาออกจากระบบแล้วเข้าใหม่ก่อนทำรายการนี้', null],
        'auth/operation-not-allowed': ['ยังไม่ได้เปิดใช้การล็อกอินด้วยอีเมลใน Firebase Console (Authentication > Sign-in method)', null],
        'auth/configuration-not-found': ['ยังไม่ได้เปิดใช้ Authentication ใน Firebase Console', null],
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.': ['apiKey ใน firebase-config.js ไม่ถูกต้อง', null],
        'permission-denied': ['ไม่มีสิทธิ์เข้าถึงฐานข้อมูล ตรวจสอบ Firestore Rules', null],
        'unavailable': ['เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจสอบอินเทอร์เน็ต', null]
    };
    const errInfo = e => ERR[e && e.code] || [`เกิดข้อผิดพลาด: ${(e && (e.code || e.message)) || 'ไม่ทราบสาเหตุ'}`, null];

    // ---------- global object ----------
    const readyCbs = [], changeCbs = [];
    let authResolve; const authPromise = new Promise(r => { authResolve = r; });
    const A = window.AOMSUK = {
        user: null, profile: null, settings: { ...DEFAULT_SETTINGS }, goals: [], wishlist: [], interests: [], notifications: [], isReady: false,
        onReady(cb) { A.isReady ? cb(A) : readyCbs.push(cb); },
        onChange(cb) { changeCbs.push(cb); },
        authState: () => authPromise,
        esc, dkey, money, newId, savedOf,
        isValidEmail: e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim()),
        lastEmail: () => { try { return localStorage.getItem('aomsuk_last_email') || ''; } catch (e) { return ''; } },
        totalSavings: () => A.goals.reduce((s, g) => s + savedOf(g), 0),
        displayName: () => (A.profile && A.profile.name) || (A.user && A.user.displayName) || 'ผู้ใช้'
    };
    const rememberEmail = e => { try { localStorage.setItem('aomsuk_last_email', e); } catch (x) { } };

    // =================================================================
    // อัปเดตเว็บอัตโนมัติ (เมื่ออัปโหลดไฟล์ใหม่ขึ้น GitHub)
    //   - ทุกครั้งที่เปิดเว็บ จะถาม GitHub ว่ามีการอัปโหลดใหม่ (commit) หรือยัง
    //   - ถ้ามี จะโหลดหน้าใหม่ด้วยลิงก์ที่มี ?v=... ทำให้มือถือ/iPad ไม่ใช้ไฟล์เก่าที่จำไว้
    //   - ทำงานเฉพาะบน xxx.github.io (ตอนทดสอบด้วย Live Server จะไม่ทำงาน)
    // =================================================================
    const BUILD_KEY = 'aomsuk_build';
    const build = () => { try { return (localStorage.getItem(BUILD_KEY) || '').slice(0, 7); } catch (x) { return ''; } };
    // เติม ?v=เวอร์ชัน ให้ลิงก์ภายในเว็บ
    const withV = url => {
        const v = build();
        if (!v || !url || /^(https?:|mailto:|tel:|#|javascript:)/i.test(url) || !/\.html(\?|#|$)/.test(url)) return url;
        const [path, hash = ''] = url.split('#');
        const clean = path.replace(/([?&])v=[^&]*&?/, '$1').replace(/[?&]$/, '');
        return `${clean}${clean.includes('?') ? '&' : '?'}v=${v}${hash ? '#' + hash : ''}`;
    };
    A.go = url => { location.href = withV(url); };
    A.goReplace = url => { location.replace(withV(url)); };
    // ลิงก์ <a href="xxx.html"> ทุกอันในเว็บ -> เติมเวอร์ชันตอนกด
    document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey) return;
        const href = a.getAttribute('href'), nh = withV(href);
        if (nh !== href) { e.preventDefault(); location.href = nh; }
    }, true);

    (function checkForUpdate() {
        if (!/\.github\.io$/i.test(location.hostname)) return;
        const owner = location.hostname.split('.')[0];
        const seg = location.pathname.split('/').filter(Boolean);
        const repo = seg.length && !/\.html$/i.test(seg[0]) ? seg[0] : `${owner}.github.io`;
        const CHECKED = 'aomsuk_build_checked';
        try { if (Date.now() - (+localStorage.getItem(CHECKED) || 0) < 60 * 1000) return; } catch (x) { return; }
        fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(list => {
                const c = list && list[0]; if (!c || !c.sha) return;
                // รอให้ GitHub Pages สร้างเว็บใหม่เสร็จก่อน (ประมาณ 1-2 นาทีหลังอัปโหลด)
                const age = Date.now() - new Date(c.commit && c.commit.committer && c.commit.committer.date).getTime();
                if (!(age > 3 * 60 * 1000)) return;
                localStorage.setItem(CHECKED, Date.now());
                const cur = localStorage.getItem(BUILD_KEY);
                if (cur === c.sha) return;
                localStorage.setItem(BUILD_KEY, c.sha);
                if (!cur) return;   // เปิดครั้งแรก แค่จำเวอร์ชันไว้
                const go = () => {
                    const bar = document.createElement('div');
                    bar.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(31,41,55,.92);color:#fff;padding:10px 18px;border-radius:9999px;font:600 14px \'Google Sans\',\'Noto Sans Thai Looped\',sans-serif;z-index:10001';
                    bar.textContent = 'มีเวอร์ชันใหม่ กำลังอัปเดต...';
                    document.body.appendChild(bar);
                    const file = location.pathname.split('/').pop() || 'index.html';
                    setTimeout(() => location.replace(withV(file + location.search) + location.hash), 600);
                };
                document.body ? go() : document.addEventListener('DOMContentLoaded', go);
            })
            .catch(() => { });
    })();

    // =================================================================
    // ธีมสี: เปลี่ยนสีทั้งเว็บ (ตั้งค่าได้ในหน้าตั้งค่า)
    //   primary = แถบหัว/ปุ่มหลัก, card = กล่องตารางออม, soft = กล่องรายการออม/บับเบิลบอท
    //   bg = พื้นหลัง, button = ปุ่มลอย "เพิ่มเป้าหมาย", avatar = วงกลมรูปโปรไฟล์
    // =================================================================
    const THEMES = {
        classic: { name: 'ออมสุขคลาสสิก', primary: '#9c8a7e', card: '#9c8a7e', soft: '#fcefdc', bg: '#d8eafe', button: '#7b8994', avatar: '#e5e7eb' },
        ocean: { name: 'ฟ้าคราม', primary: '#5581a6', card: '#7c9abe', soft: '#d2e3f5', bg: '#f5f5ed', button: '#5581a6', avatar: '#9b8b80' },
        honey: { name: 'ทองน้ำผึ้ง', primary: '#dbaf70', card: '#dbd0bf', soft: '#fae3c6', bg: '#fcf8ef', button: '#dbd0c0', avatar: '#dbd0bf' },
        grape: { name: 'ม่วงองุ่น', primary: '#b48aaf', card: '#d3a6ca', soft: '#ffd9e7', bg: '#fdf0da', button: '#b48aaf', avatar: '#b48aaf' },
        lavender: { name: 'ลาเวนเดอร์', primary: '#ceb5dc', card: '#ffb9cb', soft: '#ffdae2', bg: '#f2ecf6', button: '#f6b7c7', avatar: '#ceb5dc' },
        deepsea: { name: 'ทะเลลึก', primary: '#0d5b6a', card: '#59a2b1', soft: '#d2e3f5', bg: '#f1f2f6', button: '#0d5b6a', avatar: '#ff9d7b' },
        sakura: { name: 'ชมพูซากุระ', primary: '#eea5b8', card: '#f6b7c7', soft: '#f8d3db', bg: '#fdf0f7', button: '#f6b7c7', avatar: '#f6b7c7' },
        matcha: { name: 'เขียวมัทฉะ', primary: '#a5d6a7', card: '#a1dfa3', soft: '#bee1c9', bg: '#e9f7ea', button: '#a5d6a7', avatar: '#a5d6a7' },
        chocomint: { name: 'ช็อกโกมินต์', primary: '#8f7971', card: '#8f7971', soft: '#dbf4ee', bg: '#b6e1d0', button: '#8f7971', avatar: '#885a4a' },
        mono: { name: 'เทาโมโนโทน', primary: '#545454', card: '#545454', soft: '#d9d9d9', bg: '#a6a6a6', button: '#545454', avatar: '#545454' }
    };
    const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const rgb2hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
    const lum = h => { const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const darkenFor = (c, bg, ratio) => { let out = c; for (let t = 0.08; contrast(out, bg) < ratio && t <= 0.9; t += 0.08) out = mix(c, '#000000', t); return out; };

    function themeVars(th) {
        return {
            primary: th.primary, card: th.card, soft: th.soft, bg: th.bg, button: th.button, avatar: th.avatar,
            'primary-dark': mix(th.primary, '#000000', 0.12),
            'button-dark': mix(th.button, '#000000', 0.12),
            accent: darkenFor(th.primary, '#ffffff', 3),          // ตัวหนังสือสีธีมบนพื้นขาว (อ่านง่าย)
            ink: darkenFor(mix(th.primary, '#000000', 0.3), '#ffffff', 4.5),
            tint: mix(th.primary, '#ffffff', 0.86),
            input: mix(th.soft, '#ffffff', 0.45),
            line: mix(th.primary, '#ffffff', 0.62),
            'soft-light': mix(th.soft, '#ffffff', 0.4),
            bubble: darkenFor(th.primary, '#ffffff', 2.6)        // บับเบิลข้อความผู้ใช้ (ตัวหนังสือขาว)
        };
    }

    // แทนที่สีเดิมในคลาส Tailwind ด้วยสีของธีม (ใช้เฉพาะตอนเลือกธีมที่ไม่ใช่คลาสสิก)
    function themeCSS() {
        const MAP = {
            '9c8a7e': { bg: 'primary', text: 'accent', border: 'primary', ring: 'primary' }, '8a7a6f': { bg: 'primary-dark' },
            'f4efe9': { bg: 'tint' }, 'fdf3e7': { bg: 'input' }, '7a6a5f': { text: 'ink' }, 'd8eafe': { bg: 'bg' },
            'fcefdc': { bg: 'soft', border: 'soft' }, 'd9cfc7': { border: 'line' }, 'e6d8c6': { border: 'line' },
            'fdf3e6': { bg: 'soft-light' }, 'a3948b': { bg: 'bubble' }, '7b8994': { bg: 'button' }, '637079': { bg: 'button-dark' }
        };
        const PROP = { bg: 'background-color', text: 'color', border: 'border-color', ring: '--tw-ring-color' };
        const e = s => s.replace(/[[\]#:/]/g, m => '\\' + m);
        const rules = [];
        for (const [hex, utils] of Object.entries(MAP))
            for (const [u, v] of Object.entries(utils))
                for (const [pre, ps] of [['', ''], ['hover:', ':hover'], ['focus:', ':focus']])
                    rules.push(`html[data-theme] .${e(`${pre}${u}-[#${hex}]`)}${ps}{${PROP[u]}:var(--t-${v})!important}`);
        rules.push(
            `html[data-theme] .${e('bg-[#fdf3e7]/60')}{background-color:color-mix(in srgb,var(--t-input) 60%,transparent)!important}`,
            'html[data-theme] #scheduleBox{background-color:var(--t-card)!important;border-color:var(--t-card)!important}',
            'html[data-theme] #avatarCircle{background-color:var(--t-avatar)!important}',
            'html[data-theme] #avatarCircle i{color:#fff!important}',
            'html[data-theme] .goal-header{border-bottom-color:var(--t-primary)!important}',
            'html[data-theme] .switch input:checked+span{background:var(--t-primary)!important}',
            'html[data-theme] .dot{background:var(--t-primary)!important}'
        );
        return rules.join('\n');
    }
    (function injectThemeCSS() {
        const st = document.createElement('style'); st.id = 'aomsukTheme'; st.textContent = themeCSS();
        (document.head || document.documentElement).appendChild(st);
    })();

    let currentTheme = 'classic';
    function applyTheme(id) {
        if (!THEMES[id]) id = 'classic';
        currentTheme = id;
        const root = document.documentElement, vars = themeVars(THEMES[id]);
        if (id === 'classic') {
            root.removeAttribute('data-theme');
            Object.keys(vars).forEach(k => root.style.removeProperty('--t-' + k));
        } else {
            Object.entries(vars).forEach(([k, v]) => root.style.setProperty('--t-' + k, v));
            root.setAttribute('data-theme', id);
        }
        try { localStorage.setItem('aomsuk_theme', id); } catch (x) { }
    }
    // ใช้ธีมล่าสุดทันทีตอนเปิดหน้า (ไม่ต้องรอโหลดข้อมูล จะได้ไม่กระพริบ)
    try { applyTheme(localStorage.getItem('aomsuk_theme') || 'classic'); } catch (x) { applyTheme('classic'); }
    // ธีมที่บันทึกในบัญชี (ซิงก์ข้ามเครื่อง)
    function syncTheme() { const t = A.settings && A.settings.theme; if (t && t !== currentTheme) applyTheme(t); }

    A.themes = THEMES;
    A.themeVars = themeVars;
    A.currentTheme = () => currentTheme;

    // ---------- loading overlay (หน้าที่ต้องล็อกอิน) ----------
    if (!PUBLIC) {
        const st = document.createElement('style');
        st.textContent = 'html.aomsuk-loading body>*:not(#aomsukLoader){visibility:hidden}';
        document.head.appendChild(st);
        document.documentElement.classList.add('aomsuk-loading');
        document.addEventListener('DOMContentLoaded', () => {
            if (!document.documentElement.classList.contains('aomsuk-loading')) return;
            const l = document.createElement('div');
            l.id = 'aomsukLoader';
            l.style.cssText = 'position:fixed;inset:0;background:var(--t-bg,#d8eafe);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;font-family:\'Google Sans\',\'Noto Sans Thai Looped\',sans-serif;color:var(--t-primary,#9c8a7e)';
            l.innerHTML = '<i class="fa-solid fa-piggy-bank fa-bounce" style="font-size:48px"></i><p style="margin-top:12px;font-weight:600">กำลังโหลดข้อมูล...</p>';
            document.body.appendChild(l);
        });
    }
    function hideLoader() {
        document.documentElement.classList.remove('aomsuk-loading');
        const l = document.getElementById('aomsukLoader'); if (l) l.remove();
    }

    function showFatal(title, detail) {
        const go = () => {
            hideLoader();
            if (document.getElementById('aomsukFatal')) return;
            const d = document.createElement('div');
            d.id = 'aomsukFatal';
            d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;font-family:\'Google Sans\',\'Noto Sans Thai Looped\',sans-serif';
            d.innerHTML = `<div style="background:#fff;border-radius:24px;padding:24px;max-width:380px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.2)">
                <div style="font-size:40px">⚠️</div>
                <p style="font-weight:700;color:#9c8a7e;font-size:18px;margin:8px 0">${esc(title)}</p>
                <p style="color:#555;font-size:14px;line-height:1.6">${detail}</p>
                <button onclick="location.reload()" style="margin-top:16px;background:#9c8a7e;color:#fff;border:0;border-radius:9999px;padding:10px 20px;font-weight:600;cursor:pointer">ลองใหม่</button>
            </div>`;
            document.body.appendChild(d);
        };
        document.body ? go() : document.addEventListener('DOMContentLoaded', go);
    }

    // ---------- config check ----------
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || /YOUR_/i.test(cfg.apiKey) || /YOUR_/i.test(cfg.projectId || '')) {
        showFatal('ยังไม่ได้ตั้งค่า Firebase', 'เปิดไฟล์ <b>firebase-config.js</b> แล้ววาง config ของโปรเจกต์ Firebase ของคุณแทนค่า YOUR_... (ดูขั้นตอนในคู่มือ)');
        return;
    }

    // ---------- boot ----------
    let fb = null, listening = false, unsubs = [];
    const booted = (async () => {
        const [appM, authM, fsM] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
        const app = appM.initializeApp(cfg);
        fb = { authM, fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
        let first = true;
        authM.onAuthStateChanged(fb.auth, user => {
            A.user = user;
            if (first) { first = false; authResolve(user); }
            if (!user) {
                unsubs.forEach(u => u()); unsubs = []; listening = false;
                if (!PUBLIC) A.goReplace('login.html');
                return;
            }
            if (!PUBLIC && !listening) startListeners();
        });
    })();
    booted.catch(e => { console.error(e); showFatal('โหลด Firebase ไม่สำเร็จ', 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต หรือค่าใน firebase-config.js<br><small style="color:#999">' + esc(e && e.message) + '</small>'); });

    const userDoc = () => fb.fsM.doc(fb.db, 'users', A.user.uid);
    const sub = (...p) => fb.fsM.doc(fb.db, 'users', A.user.uid, ...p);
    const subCol = name => fb.fsM.collection(fb.db, 'users', A.user.uid, name);

    function onSnapErr(e) {
        console.error(e);
        if (e && e.code === 'permission-denied') showFatal('ไม่มีสิทธิ์เข้าถึงฐานข้อมูล', 'กรุณาตั้งค่า Firestore Rules ตามคู่มือ (ไฟล์ firestore.rules)');
        else showFatal('เชื่อมต่อฐานข้อมูลไม่ได้', esc(errInfo(e)[0]));
    }

    function startListeners() {
        listening = true;
        const { fsM } = fb;
        const pending = new Set(['profile', 'goals', 'wishlist', 'notifications']);
        const arrived = k => {
            pending.delete(k);
            if (pending.size) return;
            if (!A.isReady) becomeReady(); else changed();
        };
        unsubs.push(fsM.onSnapshot(userDoc(), snap => {
            const d = snap.exists() ? snap.data() : null;
            A.profile = d || { name: A.user.displayName || '', email: A.user.email };
            A.settings = { ...DEFAULT_SETTINGS, ...((d && d.settings) || {}) };
            A.interests = (d && Array.isArray(d.interests)) ? d.interests : [];
            if (!d) fsM.setDoc(userDoc(), { name: A.user.displayName || '', email: A.user.email, createdAt: nowISO(), settings: DEFAULT_SETTINGS, interests: [] }, { merge: true }).catch(onSnapErr);
            arrived('profile');
        }, onSnapErr));
        const col = (name, set) => unsubs.push(fsM.onSnapshot(subCol(name), snap => {
            const arr = []; snap.forEach(doc => arr.push({ ...doc.data(), id: doc.id })); set(arr); arrived(name);
        }, onSnapErr));
        col('goals', arr => { A.goals = arr.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))); });
        col('wishlist', arr => { A.wishlist = arr; });
        col('notifications', arr => {
            allNotifs = arr;   // รวมอันที่ลบ (ซ่อน) แล้ว ไว้กันไม่ให้สร้างซ้ำ
            A.notifications = arr.filter(n => !n.hidden).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        });
    }

    function becomeReady() {
        A.isReady = true;
        const run = () => {
            syncTheme();
            hideLoader();
            decorateSidebar();
            setupBell();
            readyCbs.splice(0).forEach(cb => { try { cb(A); } catch (e) { console.error(e); } });
            renderBell();
            generateSoon();
        };
        document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', run) : run();
    }
    function changed() {
        syncTheme();
        changeCbs.forEach(cb => { try { cb(A); } catch (e) { console.error(e); } });
        renderBell(); renderPanel(); decorateSidebar(); generateSoon();
    }

    // ---------- auth actions ----------
    A.register = async ({ name, email, password }) => {
        try {
            await booted;
            const { authM, fsM } = fb;
            const cred = await authM.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
            A.user = cred.user;
            await authM.updateProfile(cred.user, { displayName: name.trim() });
            await fsM.setDoc(userDoc(), { name: name.trim(), email: cred.user.email, createdAt: nowISO(), settings: DEFAULT_SETTINGS, interests: [] });
            await fsM.setDoc(sub('notifications', 'welcome'), { type: 'welcome', title: `ยินดีต้อนรับ ${name.trim()}! 🐷`, body: 'เริ่มจากตั้งเป้าหมายสิ่งที่อยากได้ แล้วให้แชทบอทช่วยจัดตารางออมเงินให้นะ', link: 'add-goal.html', read: false, createdAt: nowISO() });
            rememberEmail(cred.user.email);
            return { ok: true };
        } catch (e) { const [error, field] = errInfo(e); return { error, field }; }
    };
    A.login = async (email, password) => {
        try {
            await booted;
            const cred = await fb.authM.signInWithEmailAndPassword(fb.auth, email.trim(), password);
            rememberEmail(cred.user.email);
            return { ok: true };
        } catch (e) { const [error, field] = errInfo(e); return { error, field }; }
    };
    A.resetPassword = async email => {
        try { await booted; await fb.authM.sendPasswordResetEmail(fb.auth, email.trim()); return { ok: true }; }
        catch (e) { const [error, field] = errInfo(e); return { error, field }; }
    };
    A.logout = async () => { await booted; await fb.authM.signOut(fb.auth); A.goReplace('login.html'); };

    async function reauth(currentPassword) {
        const { authM } = fb;
        await authM.reauthenticateWithCredential(fb.auth.currentUser, authM.EmailAuthProvider.credential(fb.auth.currentUser.email, currentPassword));
    }
    A.changePassword = async (currentPassword, newPassword) => {
        try { await booted; await reauth(currentPassword); await fb.authM.updatePassword(fb.auth.currentUser, newPassword); return { ok: true }; }
        catch (e) { const [error, field] = errInfo(e); return { error, field }; }
    };
    A.deleteAccount = async currentPassword => {
        try {
            await booted; await reauth(currentPassword);
            const { fsM } = fb;
            unsubs.forEach(u => u()); unsubs = [];
            for (const name of ['goals', 'wishlist', 'notifications']) {
                const snap = await fsM.getDocs(subCol(name));
                const ids = []; snap.forEach(d => ids.push(d.id));
                await Promise.all(ids.map(id => fsM.deleteDoc(sub(name, id))));
            }
            await fsM.deleteDoc(userDoc());
            await fb.authM.deleteUser(fb.auth.currentUser);
            return { ok: true };
        } catch (e) { const [error, field] = errInfo(e); return { error, field }; }
    };

    // ---------- data actions ----------
    const w = fn => async (...args) => { await booted; try { return await fn(...args); } catch (e) { console.error(e); throw Object.assign(new Error(errInfo(e)[0]), { code: e.code }); } };
    A.saveGoal = w(g => fb.fsM.setDoc(sub('goals', g.id), clean({ ...g, updatedAt: nowISO() })));
    A.deleteGoal = w(id => fb.fsM.deleteDoc(sub('goals', id)));
    A.deleteAllGoals = w(() => Promise.all(A.goals.map(g => fb.fsM.deleteDoc(sub('goals', g.id)))));
    A.deleteAllWishes = w(() => Promise.all(A.wishlist.map(x => fb.fsM.deleteDoc(sub('wishlist', x.id)))));
    A.saveWish = w(item => fb.fsM.setDoc(sub('wishlist', item.id), clean(item)));
    A.deleteWish = w(id => fb.fsM.deleteDoc(sub('wishlist', id)));
    A.setInterests = w(arr => fb.fsM.setDoc(userDoc(), { interests: arr }, { merge: true }));
    A.updateSettings = w(partial => fb.fsM.setDoc(userDoc(), { settings: partial }, { merge: true }));
    // เปลี่ยนธีม: เปลี่ยนสีทันที แล้วบันทึกลงบัญชี
    A.setTheme = async id => { applyTheme(id); A.settings.theme = currentTheme; await A.updateSettings({ theme: currentTheme }); };
    // รายรับ/รายจ่ายที่เล่าให้แชทบอทฟัง (users/{uid}.finance) จะได้ไม่ต้องบอกซ้ำทุกครั้ง
    A.finance = () => (A.profile && A.profile.finance) || null;
    A.saveFinance = w(async fin => {
        if (fin) fin = { income: fin.income || null, expenses: fin.expenses || [], updatedAt: nowISO() };
        await fb.fsM.setDoc(userDoc(), clean({ finance: fin || null }), { merge: true });
    });

    // รูปโปรไฟล์ (เก็บเป็นรูปย่อขนาดเล็กใน users/{uid}.photo)
    A.photo = () => (A.profile && A.profile.photo) || null;
    A.updatePhoto = w(photo => fb.fsM.setDoc(userDoc(), { photo: photo || null }, { merge: true }));

    // ย่อ + ครอปรูปเป็นสี่เหลี่ยมจัตุรัส แล้วแปลงเป็น JPEG ขนาดเล็ก (ใช้ได้กับไฟล์จากคอมและมือถือ)
    A.resizeImage = (file, size = 480) => new Promise((resolve, reject) => {
        if (!file) return reject(new Error('ไม่ได้เลือกไฟล์'));
        if (file.type && !/^image\//.test(file.type)) return reject(new Error('กรุณาเลือกไฟล์รูปภาพ'));
        if (file.size > 20 * 1024 * 1024) return reject(new Error('ไฟล์ใหญ่เกินไป (ไม่เกิน 20MB)'));
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const s = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2, out = Math.min(size, s);
            const c = document.createElement('canvas'); c.width = c.height = out;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out);
            ctx.drawImage(img, sx, sy, s, s, 0, 0, out, out);
            let q = 0.85, data = c.toDataURL('image/jpeg', q);
            while (data.length > 200000 && q > 0.4) { q -= 0.15; data = c.toDataURL('image/jpeg', q); }
            resolve(data);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปนี้ไม่ได้ ลองใช้รูป JPG หรือ PNG')); };
        img.src = url;
    });

    A.updateName = w(async name => {
        await fb.fsM.setDoc(userDoc(), { name }, { merge: true });
        await fb.authM.updateProfile(fb.auth.currentUser, { displayName: name });
    });

    // ---------- notifications ----------
    const inFlight = new Set();
    let allNotifs = [];
    A.notify = w(async (id, n) => {
        if (inFlight.has(id) || allNotifs.some(x => x.id === id) || A.notifications.some(x => x.id === id)) return false;
        inFlight.add(id);
        try { await fb.fsM.setDoc(sub('notifications', id), clean({ read: false, createdAt: nowISO(), link: '', ...n })); }
        finally { setTimeout(() => inFlight.delete(id), 3000); }
        if (A.settings.browserNotif && ['due', 'missed', 'reached', 'afford'].includes(n.type)) browserNotify(n);
        return true;
    });
    A.markRead = w(id => fb.fsM.setDoc(sub('notifications', id), { read: true }, { merge: true }));
    A.markAllRead = w(() => Promise.all(A.notifications.filter(n => !n.read).map(n => fb.fsM.setDoc(sub('notifications', n.id), { read: true }, { merge: true }))));
    // ลบแจ้งเตือน = ซ่อนไว้ (ระบบจะได้ไม่สร้างแจ้งเตือนเดิมขึ้นมาใหม่)
    A.deleteNotification = w(id => fb.fsM.setDoc(sub('notifications', id), { hidden: true, read: true }, { merge: true }));
    A.clearNotifications = w(() => Promise.all(A.notifications.map(n => fb.fsM.setDoc(sub('notifications', n.id), { hidden: true, read: true }, { merge: true }))));
    A.unreadCount = () => A.notifications.filter(n => !n.read).length;

    function browserNotify(n) {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const x = new Notification(n.title, { body: n.body, tag: n.type });
            x.onclick = () => { window.focus(); if (n.link) A.go(n.link); };
        } catch (e) { }
    }

    // สร้างการแจ้งเตือนอัตโนมัติจากข้อมูล (ใช้ id คงที่ จึงไม่ซ้ำ)
    let genTimer = null;
    function generateSoon() { clearTimeout(genTimer); genTimer = setTimeout(generate, 400); }
    function generate() {
        if (!A.isReady || !A.user) return;
        const s = A.settings, today = new Date(), tkey = dkey(today);
        A.goals.forEach(g => {
            const items = g.schedule || [];
            const it = items.find(i => i.date === tkey);
            const dueId = `due_${g.id}_${tkey}`;
            if (s.notifyDue && it && !it.saved) A.notify(dueId, { type: 'due', title: 'ถึงเวลาออมแล้ว 🐷', body: `วันนี้ออม ${money(it.amount)} ฿ สำหรับ "${g.title}"`, link: 'dashboard.html' }).catch(() => { });
            const dn = A.notifications.find(n => n.id === dueId);
            if (dn && !dn.read && it && it.saved) A.markRead(dueId).catch(() => { });
            if (s.notifyMissed) for (let k = 1; k <= 3; k++) {
                const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - k), key = dkey(d);
                const m = items.find(i => i.date === key);
                if (m && !m.saved) A.notify(`missed_${g.id}_${key}`, { type: 'missed', title: 'พลาดการออม 😔', body: `วันที่ ${d.getDate()}/${d.getMonth() + 1} ยังไม่ได้ออม ${money(m.amount)} ฿ ("${g.title}") ติ๊กย้อนหลังได้นะ`, link: 'dashboard.html' }).catch(() => { });
            }
            if (s.notifyGoal && g.target > 0 && savedOf(g) >= g.target - 0.001)
                A.notify(`reached_${g.id}`, { type: 'reached', title: 'ถึงเป้าหมายแล้ว! 🎉', body: `คุณออมครบ ${money(g.target)} ฿ สำหรับ "${g.title}" แล้ว เก่งมาก!`, link: 'dashboard.html' }).catch(() => { });
        });
        if (s.notifyWish) {
            const total = A.totalSavings();
            A.wishlist.forEach(x => {
                if (total > 0 && total >= x.price) A.notify(`afford_${x.id}`, { type: 'afford', title: 'ซื้อได้แล้ว! 🛍️', body: `เงินออม ${money(total)} ฿ พอสำหรับ "${x.name}" (${(+x.price).toLocaleString('th-TH')} ฿) แล้ว`, link: 'dashboard.html' }).catch(() => { });
            });
        }
    }

    // ---------- UI: sidebar ----------
    function decorateSidebar() {
        const sb = document.getElementById('sidebar'); if (!sb) return;
        const links = [...sb.querySelectorAll('nav a')];
        const acc = links.find(a => a.dataset.account || a.textContent.includes('บัญชีของฉัน'));
        if (acc) {
            acc.dataset.account = '1'; acc.href = 'settings.html';
            const photo = A.photo(), cur = acc.querySelector('i, img');
            if (cur && (cur.tagName === 'IMG') !== !!photo || (photo && cur && cur.getAttribute('src') !== photo)) {
                const el = photo ? Object.assign(document.createElement('img'), { src: photo, alt: '', className: 'w-8 h-8 rounded-full object-cover shrink-0' })
                    : Object.assign(document.createElement('i'), { className: 'fa-solid fa-circle-user text-2xl text-black' });
                cur.replaceWith(el);
            }
            const span = acc.querySelector('span');
            if (span) span.innerHTML = `${esc(A.displayName())}<span class="block text-[11px] font-normal text-gray-500 truncate max-w-[150px]">${esc(A.user.email)}</span>`;
        }
        const set = links.find(a => a.textContent.trim() === 'ตั้งค่า'); if (set) set.href = 'settings.html';
        const nav = sb.querySelector('nav');
        if (nav && !document.getElementById('logoutLink')) {
            const a = document.createElement('a');
            a.href = '#'; a.id = 'logoutLink';
            a.className = 'flex items-center gap-4 px-6 py-5 text-red-500 font-bold hover:bg-red-50 border-b border-gray-200';
            a.innerHTML = '<i class="fa-solid fa-right-from-bracket text-2xl"></i><span>ออกจากระบบ</span>';
            a.addEventListener('click', e => { e.preventDefault(); if (confirm('ต้องการออกจากระบบใช่ไหม?')) A.logout(); });
            nav.append(a);
        }
    }

    // ---------- UI: bell + notification panel ----------
    const ICON = {
        due: ['fa-piggy-bank', 'bg-amber-100 text-amber-600'], missed: ['fa-face-frown', 'bg-rose-100 text-rose-500'],
        reached: ['fa-trophy', 'bg-yellow-100 text-yellow-600'], afford: ['fa-bag-shopping', 'bg-green-100 text-green-600'],
        plan: ['fa-calendar-check', 'bg-sky-100 text-sky-600'], wish: ['fa-star', 'bg-violet-100 text-violet-500'],
        welcome: ['fa-hand-sparkles', 'bg-[#f4efe9] text-[#9c8a7e]']
    };
    function ago(iso) {
        const t = new Date(iso), s = (Date.now() - t) / 1000;
        if (s < 60) return 'เมื่อสักครู่';
        if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
        if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
        if (s < 86400 * 7) return `${Math.floor(s / 86400)} วันที่แล้ว`;
        return t.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
    }
    let bellReady = false, freshIds = new Set();
    function setupBell() {
        if (bellReady) return;
        let btn = document.getElementById('bellBtn');
        if (!btn) {
            const icon = document.querySelector('.fa-bell'); if (!icon) return;
            btn = icon.closest('button,div'); btn.id = 'bellBtn';
        }
        bellReady = true;
        btn.style.cursor = 'pointer'; btn.classList.add('relative');
        btn.setAttribute('aria-label', 'การแจ้งเตือน');
        if (!document.getElementById('bellBadge')) {
            const b = document.createElement('span'); b.id = 'bellBadge';
            b.className = 'hidden absolute -top-1 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center';
            btn.appendChild(b);
        }
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div id="notifBackdrop" class="hidden fixed inset-0 z-[55]"></div>
            <div id="notifPanel" class="hidden fixed top-[68px] right-2 left-2 sm:left-auto sm:w-96 z-[60] bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
                <div class="flex items-center justify-between px-5 py-3 border-b-2 border-[#9c8a7e] mx-3">
                    <h3 class="font-bold text-[#9c8a7e] text-lg">การแจ้งเตือน</h3>
                    <span class="text-xs text-gray-400"><i class="fa-solid fa-hand-point-left mr-1"></i>ปัดซ้ายเพื่อลบ</span>
                </div>
                <div id="notifList" class="max-h-[60vh] overflow-y-auto px-3 py-2"></div>
                <a href="settings.html#notifications" class="block text-center text-xs text-gray-500 py-3 border-t border-gray-100 hover:text-[#9c8a7e]"><i class="fa-solid fa-gear mr-1"></i>ตั้งค่าการแจ้งเตือน</a>
            </div>`;
        document.body.append(...wrap.children);
        const panel = document.getElementById('notifPanel'), bd = document.getElementById('notifBackdrop');
        // เปิดกระดิ่ง = ถือว่าเห็นแล้ว -> ตัวเลขหายทันที (รายการใหม่ยังไฮไลต์ไว้ให้เห็นในรอบนี้)
        const toggle = open => {
            panel.classList.toggle('hidden', !open); bd.classList.toggle('hidden', !open);
            if (!open) { freshIds = new Set(); return; }
            freshIds = new Set(A.notifications.filter(n => !n.read).map(n => n.id));
            renderPanel();
            if (freshIds.size) {
                const ids = [...freshIds];
                A.notifications.forEach(n => { if (freshIds.has(n.id)) n.read = true; });
                renderBell();
                ids.forEach(id => A.markRead(id).catch(() => { }));
            }
        };
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggle(panel.classList.contains('hidden')); });
        bd.addEventListener('click', () => toggle(false));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
        const list = document.getElementById('notifList');
        const OPEN_X = -88;
        const setX = (el, x, animate) => { el.style.transition = animate ? 'transform .2s ease' : 'none'; el.style.transform = x ? `translateX(${x}px)` : ''; el.dataset.open = x ? '1' : ''; };
        const closeAll = except => list.querySelectorAll('[data-front][data-open="1"]').forEach(el => { if (el !== except) setX(el, 0, true); });
        const removeNotif = id => {
            const row = list.querySelector(`[data-row="${CSS.escape(id)}"]`);
            if (row) { row.style.transition = 'opacity .2s, max-height .25s'; row.style.maxHeight = row.offsetHeight + 'px'; requestAnimationFrame(() => { row.style.opacity = '0'; row.style.maxHeight = '0px'; }); }
            setTimeout(() => {
                A.notifications = A.notifications.filter(n => n.id !== id);
                renderPanel(); renderBell();
                A.deleteNotification(id).catch(() => { });
            }, 230);
        };
        // ปัดซ้าย (นิ้ว/เมาส์) เพื่อโชว์ปุ่ม "ลบ" สีแดง, ปัดยาวๆ = ลบเลย
        let sw = null;
        list.addEventListener('pointerdown', e => {
            const el = e.target.closest('[data-front]'); if (!el) return;
            closeAll(el);
            sw = { el, x0: e.clientX, y0: e.clientY, base: el.dataset.open ? OPEN_X : 0, x: el.dataset.open ? OPEN_X : 0, axis: null, moved: false };
        });
        list.addEventListener('pointermove', e => {
            if (!sw) return;
            const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
            if (!sw.axis) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; sw.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
            if (sw.axis !== 'x') return;
            sw.moved = true;
            sw.x = Math.min(0, Math.max(-160, sw.base + dx));
            setX(sw.el, sw.x, false);
        });
        const endSwipe = () => {
            if (!sw) return; const s = sw; sw = null;
            if (!s.moved) return;
            s.el.dataset.swiped = '1'; setTimeout(() => { delete s.el.dataset.swiped; }, 80);
            if (s.x < -130) removeNotif(s.el.dataset.nid);
            else setX(s.el, s.x < OPEN_X / 2 ? OPEN_X : 0, true);
        };
        list.addEventListener('pointerup', endSwipe);
        list.addEventListener('pointercancel', () => { if (sw) { setX(sw.el, sw.base, true); sw = null; } });
        list.addEventListener('click', e => {
            const del = e.target.closest('[data-del-nid]');
            if (del) { removeNotif(del.dataset.delNid); return; }
            const item = e.target.closest('[data-front]'); if (!item) return;
            if (item.dataset.swiped) return;
            if (item.dataset.open) { setX(item, 0, true); return; }
            const n = A.notifications.find(x => x.id === item.dataset.nid); if (!n) return;
            if (n.link && !location.pathname.endsWith(n.link)) A.go(n.link); else toggle(false);
        });
    }
    function renderBell() {
        const b = document.getElementById('bellBadge'); if (!b) return;
        const n = A.unreadCount();
        b.textContent = n > 9 ? '9+' : n;
        b.classList.toggle('hidden', !n); b.classList.toggle('flex', !!n);
    }
    function renderPanel() {
        const list = document.getElementById('notifList'); if (!list) return;
        const all = A.notifications.slice(0, 50);
        if (!all.length) {
            list.innerHTML = '<div class="text-center py-10 text-gray-400"><i class="fa-regular fa-bell-slash text-4xl mb-2"></i><p class="text-sm">ยังไม่มีการแจ้งเตือน</p></div>';
            return;
        }
        list.innerHTML = all.map(n => {
            const [icon, cls] = ICON[n.type] || ['fa-bell', 'bg-gray-100 text-gray-500'];
            const isNew = !n.read || freshIds.has(n.id);
            return `<div data-row="${esc(n.id)}" class="relative overflow-hidden rounded-2xl mb-1">
              <button data-del-nid="${esc(n.id)}" class="absolute inset-y-0 right-0 w-[88px] bg-red-500 text-white font-bold text-sm flex flex-col items-center justify-center gap-1" aria-label="ลบแจ้งเตือน"><i class="fa-solid fa-trash-can"></i>ลบ</button>
              <div data-front data-nid="${esc(n.id)}" role="button" tabindex="0" style="touch-action:pan-y" class="relative z-10 w-full text-left flex gap-3 items-start p-3 rounded-2xl cursor-pointer select-none ${isNew ? 'bg-[#fdf3e7]' : 'bg-white'}">
                <div class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center ${cls}"><i class="fa-solid ${icon}"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm ${isNew ? 'font-bold text-gray-800' : 'font-medium text-gray-600'}">${esc(n.title)}</p>
                    <p class="text-xs text-gray-500 leading-snug">${esc(n.body)}</p>
                    <p class="text-[10px] text-gray-400 mt-0.5">${ago(n.createdAt)}</p>
                </div>
                ${isNew ? '<span class="text-[10px] font-bold text-red-500 mt-1 shrink-0">ใหม่</span>' : ''}
              </div>
            </div>`;
        }).join('');
    }
})();
