require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// --- 🔐 KONFIGURASI KREDENSIAL (Sesuai Kode Teruji) ---
// --- KREDENSIAL ---
const clientId = "685c857c-8edb-4a3c-a800-c27980d23216";
const clientSecret = "ZQ6G4Ry1yYRTLp3M1MEdKRHEa";
const username = "LI504NUNN";
const pin = "Ag7QKv4ZAnOeliF";
const serverKey = "Io5cT4CBgI5GZY3TEI2hgelk";

const ADMIN_PHONE = '6282323907426';
const ADMIN_EMAIL = 'linkutransport@gmail.com';
const DEFAULT_EMAIL = 'linkutransport@gmail.com';

// --- 📱 KONFIGURASI TWILIO & EMAIL ---
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioFrom = 'whatsapp:+62882005447472';

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: 'linkutransport@gmail.com', pass: 'qbckptzxgdumxtdm' },
    tls: { rejectUnauthorized: true }
});

// --- 🐘 DATABASE ---
const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

// --- 📸 MULTER (FOTO) ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// --- 🛠️ FUNGSI UTILITY (MENIRU KODE TERUJI) ---

function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    console.log(message);
}

function generatePartnerReff() {
    return `INV-${moment().tz('Asia/Jakarta').format('YYYYMMDDHHmmss')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function getExpiredTimestamp(minutes = 1440) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generateSignaturePOST(data, path) {
    const method = 'POST';
    const paramsOrder = path.includes('/va') ?
        ['amount', 'expired', 'bank_code', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId'] :
        ['amount', 'expired', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId'];

    let rawValue = paramsOrder.map(key => data[key] || '').join('');
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;

    const sig = crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
    logToFile(`[SIG DEBUG] Path: ${path} | StringToSign: ${signToString} | Result: ${sig}`);
    return sig;
}

function formatWA(number) {
    if (!number) return null;
    const clean = number.toString().replace(/\D/g, '');
    if (clean.startsWith('0')) return `whatsapp:+62${clean.slice(1)}`;
    if (clean.startsWith('62')) return `whatsapp:+${clean}`;
    return `whatsapp:+${clean}`;
}

const formatIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

// --- ⚡ ENDPOINTS ---

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, method, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440); // 24 jam
        const finalEmail = (email && email.trim() !== "") ? email : DEFAULT_EMAIL;

        const sigData = { amount, expired, bank_code: method, partner_reff, customer_id: nama, customer_name: nama, customer_email: finalEmail, clientId };
        const signature = generateSignaturePOST(sigData, '/transaction/create/va');

        logToFile(`[REQUEST VA] Sending to LinkQu for ${nama}`);
        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', {
            amount, bank_code: method, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail, url_callback: "https://layanan.linku.co.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        const result = response.data;

        // Simpan ke database (Sesuai skema Anda dengan Binary Foto)
        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'VA', method, partner_reff, result.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(result);
    } catch (err) {
        logToFile(`❌ VA Error: ${err.response?.data?.error || err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30); // 30 Menit
        const finalEmail = (email && email.trim() !== "") ? email : DEFAULT_EMAIL;

        const sigData = { amount, expired, partner_reff, customer_id: nama, customer_name: nama, customer_email: finalEmail, clientId };
        const signature = generateSignaturePOST(sigData, '/transaction/create/qris');

        logToFile(`[REQUEST QRIS] Sending to LinkQu for ${nama}`);
        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', {
            amount, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail, url_callback: "https://layanan.linku.co.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        const result = response.data;

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'QRIS', 'QRIS', partner_reff, result.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(result);
    } catch (err) {
        logToFile(`❌ QRIS Error: ${err.response?.data?.error || err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// 3. CALLBACK (Meniru Alur Teruji)
app.post('/callback', async (req, res) => {
    const { partner_reff } = req.body;
    logToFile(`>>> CALLBACK RECEIVED: ${partner_reff}`);
    try {
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        const order = rows[0];

        if (!order || order.status_pembayaran === 'PAID') {
            return res.json({ status: 'DONE' });
        }

        // Update Database
        await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);

        // WhatsApp Customer (Template 7 Variabel)
        const waVariables = {
            1: order.nama_user,
            2: partner_reff,
            3: order.nama_paket,
            4: "AKTIF/SUKSES",
            5: moment().format('DD/MM/YYYY'),
            6: moment().format('HH:mm'),
            7: formatIDR(order.total_bayar)
        };

        try {
            await twilioClient.messages.create({
                from: twilioFrom,
                to: formatWA(order.nomor_hp),
                contentSid: 'HX83d2f6ce8fa5693a942935bb0f44a77d',
                contentVariables: JSON.stringify(waVariables)
            });
            logToFile(`✅ WA Success to ${order.nomor_hp}`);
        } catch (e) { logToFile(`❌ WA Failed: ${e.message}`); }

        // WA Admin
        const msgAdmin = `✅ *PEMBAYARAN LUNAS*\n\nInv: ${partner_reff}\nUser: ${order.nama_user}\nPaket: ${order.nama_paket}\nTotal: ${formatIDR(order.total_bayar)}`;
        await twilioClient.messages.create({ from: twilioFrom, to: formatWA(ADMIN_PHONE), body: msgAdmin });

        res.json({ status: 'SUCCESS' });
    } catch (err) {
        logToFile(`❌ Callback Error: ${err.message}`);
        res.status(500).send(err.message);
    }
});

// 4. CHECK STATUS (Meniru Alur Teruji)
app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;
    try {
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        const order = rows[0];
        if (!order) return res.status(404).json({ error: "Order Not Found" });

        if (order.status_pembayaran === 'PAID') return res.json({ current_status: 'PAID' });

        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: partner_reff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        const linkquStatus = response.data;
        if (linkquStatus.status_code === '00' || linkquStatus.status === 'SUKSES') {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);
            return res.json({ current_status: 'PAID', linkqu_response: linkquStatus });
        }

        res.json({ current_status: 'PENDING', linkqu_response: linkquStatus });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logToFile(`🚀 Server running on port ${PORT}`));