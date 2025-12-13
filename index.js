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

// 🔐 Kredensial (Identik dengan contoh Anda)
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

// --- FUNGSI UTILITY (MENIRU CONTOH ANDA) ---

function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    const prefix = 'INV-782372373627';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${randomStr}`;
}

// 🔐 Signature POST VA (Identik dengan contoh)
function generateSignaturePOST({ amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const path = '/transaction/create/va';
    const method = 'POST';
    const rawValue = amount + expired + bank_code + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// 🔐 Signature QRIS (Identik dengan contoh)
function generateSignatureQRIS({ amount, expired, partner_reff, customer_id, customer_name, customer_email, clientId, serverKey }) {
    const path = '/transaction/create/qris';
    const method = 'POST';
    const rawValue = amount + expired + partner_reff + customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// --- ENDPOINTS ---

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440); // 24 Jam
        const finalEmail = (body.email && body.email.trim() !== "") ? body.email : "linkutransport@gmail.com";

        // Generate Signature menggunakan pola objek (Meniru Contoh Anda)
        const signature = generateSignaturePOST({
            amount: body.amount,
            expired,
            bank_code: body.method,
            partner_reff,
            customer_id: body.nama,
            customer_name: body.nama,
            customer_email: finalEmail,
            clientId,
            serverKey
        });

        const payload = {
            amount: body.amount,
            bank_code: body.method,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            customer_id: body.nama,
            customer_name: body.nama,
            customer_email: finalEmail
        };

        const headers = { 'client-id': clientId, 'client-secret': clientSecret };
        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', payload, { headers });

        // Simpan ke DB
        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [body.item, (body.amount - body.biayaAdmin), body.biayaAdmin, body.amount, body.nama, body.nomorHp, body.nik, body.kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'VA', body.method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(response.data);
    } catch (err) {
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
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: body.nama,
            customer_name: body.nama,
            customer_email: finalEmail,
            clientId,
            serverKey
        });

        const payload = {
            amount: body.amount,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            customer_id: body.nama,
            customer_name: body.nama,
            customer_email: finalEmail
        };

        const headers = { 'client-id': clientId, 'client-secret': clientSecret };
        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', payload, { headers });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [body.item, (body.amount - body.biayaAdmin), body.biayaAdmin, body.amount, body.nama, body.nomorHp, body.nik, body.kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'QRIS', 'QRIS', partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: "Gagal QRIS", detail: err.response?.data || err.message });
    }
});

// 3. CHECK STATUS & SYNC (Sesuai Logic Anda Sebelumnya)
app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: partner_reff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        // Sync database lokal jika status sukses
        if (response.data.status_code === '00' || response.data.status === 'SUKSES') {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [partner_reff]);
        }

        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));