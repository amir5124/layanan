require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const multer = require('multer');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Twilio Configuration
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// 🔐 LinkQu Credentials
const clientId = "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = "LI9019VKS";
const pin = "5m6uYAScSxQtCmU";
const serverKey = "QtwGEr997XDcmMb1Pq8S5X1N";

// 🐘 Database Pool
const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

// 📸 Multer (Parsing FormData tanpa simpan file fisik)
const upload = multer({ storage: multer.memoryStorage() });
const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// --- UTILITY ---
function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    console.log(`[${timestamp}] ${message}`);
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    return `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// 🔐 Signature Generators
function generateSignaturePOST({ amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const rawValue = amount + expired + bank_code + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = '/transaction/create/va' + 'POST' + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

function generateSignatureQRIS({ amount, expired, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const rawValue = amount + expired + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = '/transaction/create/qris' + 'POST' + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// --- ENDPOINTS ---

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, method, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440); // 24 Jam
        const finalEmail = (email && email.trim() !== "") ? email : "linkutransport@gmail.com";

        const signature = generateSignaturePOST({
            amount, expired, bank_code: method, partner_reff,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            clientId, serverKey
        });

        const payload = {
            amount, bank_code: method, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://topuplinku.siappgo.id/callback"
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', payload, {
            headers: {
                'client-id': clientId,
                'client-secret': clientSecret,
                'Content-Type': 'application/json'
            }
        });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VA', ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, finalEmail, method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        logToFile(`✅ VA Created: ${partner_reff}`);
        res.json(response.data);
    } catch (err) {
        logToFile(`❌ VA Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal membuat VA", detail: err.response?.data || err.message });
    }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30);
        const finalEmail = (email && email.trim() !== "") ? email : "linkutransport@gmail.com";

        const signature = generateSignatureQRIS({
            amount, expired, partner_reff,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            clientId, serverKey
        });

        const payload = {
            amount, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://topuplinku.siappgo.id/callback"
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', payload, {
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QRIS', 'QRIS', ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, finalEmail, partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        logToFile(`✅ QRIS Created: ${partner_reff}`);
        res.json(response.data);
    } catch (err) {
        logToFile(`❌ QRIS Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal membuat QRIS", detail: err.response?.data || err.message });
    }
});

// 3. DOWNLOAD QRIS (Endpoint Baru)
app.get('/download-qr/:partnerReff', async (req, res) => {
    try {
        const partner_reff = req.params.partnerReff;

        // Cari URL gambar di database
        const [rows] = await db.execute("SELECT qris_image_url FROM orders WHERE partner_reff = ?", [partner_reff]);

        if (rows.length === 0 || !rows[0].qris_image_url) {
            return res.status(404).json({ error: "Data QRIS tidak ditemukan" });
        }

        const imageUrl = rows[0].qris_image_url;

        // Ambil gambar dari LinkQu
        const imageResponse = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        // Set header agar browser mendownload sebagai file PNG
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename=QRIS-${partner_reff}.png`);
        res.send(imageResponse.data);

        logToFile(`📸 QRIS Downloaded: ${partner_reff}`);
    } catch (err) {
        logToFile(`❌ Download Error: ${err.message}`);
        res.status(500).json({ error: "Gagal mendownload gambar", detail: err.message });
    }
});

// 4. SEND SMS (Twilio)
app.post('/send-notif', async (req, res) => {
    const { phone, message } = req.body;
    try {
        const result = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });
        res.json({ success: true, sid: result.sid });
    } catch (err) {
        res.status(500).json({ error: "Gagal mengirim SMS", detail: err.message });
    }
});

// 5. CHECK STATUS
app.get('/check-status/:partnerReff', async (req, res) => {
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: req.params.partnerReff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        if (response.data.status_code === '00' || response.data.status === 'SUKSES') {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [req.params.partnerReff]);
        }
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));