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
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Kredensial
const clientId = "685c857c-8edb-4a3c-a800-c27980d23216";
const clientSecret = "ZQ6G4Ry1yYRTLp3M1MEdKRHEa";
const username = "LI504NUNN";
const pin = "Ag7QKv4ZAnOeliF";
const serverKey = "Io5cT4CBgI5GZY3TEI2hgelk";

// 🐘 Database
const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

const upload = multer({ storage: multer.memoryStorage() });

// --- FUNGSI UTILITY & LOGGING ---


function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    return `INV-782372373627-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// 🔐 Signature Generators (Pola Objek)
function generateSignaturePOST({ amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const path = '/transaction/create/va';
    const method = 'POST';
    const rawValue = amount + expired + bank_code + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    const result = crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
    console.log(`[SIG VA] Raw: ${cleaned} | Result: ${result}`);
    return result;
}

function generateSignatureQRIS({ amount, expired, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const path = '/transaction/create/qris';
    const method = 'POST';
    const rawValue = amount + expired + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    const result = crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
    console.log(`[SIG QRIS] Raw: ${cleaned} | Result: ${result}`);
    return result;
}

// --- ENDPOINTS ---

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440);
        const finalEmail = (body.email && body.email.trim() !== "") ? body.email : "linkutransport@gmail.com";

        const signature = generateSignaturePOST({
            amount: body.amount, expired, bank_code: body.method, partner_reff,
            customer_id: body.nama, customer_name: body.nama, customer_email: finalEmail,
            clientId, serverKey
        });

        const payload = {
            amount: body.amount, bank_code: body.method, partner_reff, username, pin, expired, signature,
            customer_id: body.nama, customer_name: body.nama, customer_email: finalEmail
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', payload, {
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [body.item, (body.amount - body.biayaAdmin), body.biayaAdmin, body.amount, body.nama, body.nomorHp, body.nik, body.kk, finalEmail, 'VA', body.method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        console.log(`✅ VA Created: ${partner_reff}`);
        res.json(response.data);
    } catch (err) {
        console.log(`❌ VA Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal VA", detail: err.response?.data || err.message });
    }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30);
        const finalEmail = (body.email && body.email.trim() !== "") ? body.email : "linkutransport@gmail.com";

        const signature = generateSignatureQRIS({
            amount: body.amount, expired, partner_reff,
            customer_id: body.nama, customer_name: body.nama, customer_email: finalEmail,
            clientId, serverKey
        });

        const payload = {
            amount: body.amount, partner_reff, username, pin, expired, signature,
            customer_id: body.nama, customer_name: body.nama, customer_email: finalEmail
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', payload, {
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QRIS', 'QRIS', ?, ?, ?, 'PENDING')`,
            [body.item, (body.amount - body.biayaAdmin), body.biayaAdmin, body.amount, body.nama, body.nomorHp, body.nik, body.kk, finalEmail, partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        console.log(`✅ QRIS Created: ${partner_reff}`);
        res.json(response.data);
    } catch (err) {
        console.log(`❌ QRIS Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal QRIS", detail: err.response?.data || err.message });
    }
});

// 3. DOWNLOAD QRIS IMAGE
app.get('/download-qr/:partnerReff', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT qris_image_url FROM orders WHERE partner_reff = ?', [req.params.partnerReff]);

        if (!rows.length || !rows[0].qris_image_url) {
            return res.status(404).send("QRIS tidak ditemukan.");
        }

        const imageUrl = rows[0].qris_image_url;
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename=QRIS-${req.params.partnerReff}.png`);
        res.send(response.data);

        console.log(`📸 QRIS Downloaded: ${req.params.partnerReff}`);
    } catch (err) {
        console.log(`❌ Download Error: ${err.message}`);
        res.status(500).send("Gagal mendownload gambar.");
    }
});

// 4. CHECK STATUS
app.get('/check-status/:partnerReff', async (req, res) => {
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: req.params.partnerReff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        if (response.data.status_code === '00' || response.data.status === 'SUKSES') {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [req.params.partnerReff]);
            console.log(`🔄 Sync Status: ${req.params.partnerReff} is PAID`);
        }

        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));