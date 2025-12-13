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

// 🔐 Kredensial Baru (Sesuai Kode Referensi)
const clientId = "685c857c-8edb-4a3c-a800-c27980d23216";
const clientSecret = "ZQ6G4Ry1yYRTLp3M1MEdKRHEa";
const username = "LI504NUNN";
const pin = "Ag7QKv4ZAnOeliF";
const serverKey = "Io5cT4CBgI5GZY3TEI2hgelk";

// 🐘 Database Konfigurasi
const db = mysql.createPool({
    host: '103.55.39.44', // IP database Anda
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

// 📸 Multer Konfigurasi (Binary Foto)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// --- FUNGSI UTILITY (LOG & SIGNATURE) ---

function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    console.log(message);
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    return `INV-782372373627-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// 🔐 Signature Generator (MENIRU PERSIS KODE REFERENSI ANDA)
function generateSignaturePOST(data, path) {
    const method = 'POST';
    let rawValue = "";

    if (path.includes('/va')) {
        rawValue = data.amount + data.expired + data.bank_code + data.partner_reff +
            data.customer_id + data.customer_name + data.customer_email + clientId;
    } else {
        rawValue = data.amount + data.expired + data.partner_reff +
            data.customer_id + data.customer_name + data.customer_email + clientId;
    }

    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;

    const sig = crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
    logToFile(`[SIG DEBUG] Path: ${path} | Raw: ${cleaned} | Result: ${sig}`);
    return sig;
}

// --- ENDPOINTS ---

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, method, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440); // 24 jam
        const finalEmail = (email && email.trim() !== "") ? email : "linkutransport@gmail.com";

        const sigData = {
            amount, expired, bank_code: method, partner_reff,
            customer_id: nama, customer_name: nama, customer_email: finalEmail
        };
        const signature = generateSignaturePOST(sigData, '/transaction/create/va');

        const payload = {
            amount, bank_code: method, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://layanan.linku.co.id/callback"
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', payload, {
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        // Simpan ke DB (Inquiry VA & Orders)
        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'VA', method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(response.data);
    } catch (err) {
        logToFile(`❌ VA Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal VA", detail: err.response?.data || err.message });
    }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, biayaAdmin, nomorHp } = req.body;
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30); // 30 Menit
        const finalEmail = (email && email.trim() !== "") ? email : "linkutransport@gmail.com";

        const sigData = {
            amount, expired, partner_reff,
            customer_id: nama, customer_name: nama, customer_email: finalEmail
        };
        const signature = generateSignaturePOST(sigData, '/transaction/create/qris');

        const payload = {
            amount, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://layanan.linku.co.id/callback"
        };

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', payload, {
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, req.files['ktp']?.[0].buffer, req.files['selfie']?.[0].buffer, finalEmail, 'QRIS', 'QRIS', partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json(response.data);
    } catch (err) {
        logToFile(`❌ QRIS Error: ${err.response?.data?.message || err.message}`);
        res.status(500).json({ error: "Gagal QRIS", detail: err.response?.data || err.message });
    }
});

// 3. CALLBACK & ADD BALANCE (LOGIC KHUSUS ANDA)
app.post('/callback', async (req, res) => {
    const { partner_reff, amount, customer_name, va_code, serialnumber } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        if (!rows.length || rows[0].status_pembayaran === 'PAID') return res.json({ message: "Selesai" });

        // Logic Tambah Saldo ke linku.co.id
        const username_target = customer_name.trim().split(" ").pop();
        const admin_fee = (va_code === "QRIS") ? Math.round(amount * 0.008) : 2500;
        const net_amount = amount - admin_fee;

        const formdata = new FormData();
        formdata.append("amount", net_amount);
        formdata.append("username", username_target);
        formdata.append("note", `Payment ${partner_reff} via ${va_code}`);

        await axios.post('https://linku.co.id/qris.php', formdata, { headers: formdata.getHeaders() });

        // Update DB
        await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);

        logToFile(`✅ Berhasil Tambah Saldo: ${username_target} | ${net_amount}`);
        res.json({ message: "Callback sukses" });
    } catch (err) {
        logToFile(`❌ Callback Error: ${err.message}`);
        res.status(500).send("Error");
    }
});

// 4. CHECK STATUS & AUTO-SYNC
app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;

    try {
        // 1. Cek data di database internal dulu
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        const order = rows[0];

        if (!order) {
            return res.status(404).json({ error: "Order tidak ditemukan di database." });
        }

        // Jika status di DB sudah PAID, langsung kirim respon sukses
        if (order.status_pembayaran === 'PAID') {
            return res.json({ current_status: 'PAID', message: "Transaksi sudah lunas." });
        }

        // 2. Jika masih PENDING, tanya ke API LinkQu
        logToFile(`[CHECK STATUS] Menanyakan status ke LinkQu untuk: ${partner_reff}`);
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: {
                username: username,
                partnerreff: partner_reff
            },
            headers: {
                'client-id': clientId,
                'client-secret': clientSecret
            }
        });

        const linkquStatus = response.data;
        // Status '00' atau 'SUKSES' berarti sudah dibayar
        const isPaid = linkquStatus.status_code === '00' || linkquStatus.status === 'SUKSES';

        if (isPaid) {
            logToFile(`[SYNC] LinkQu menyatakan lunas, memproses penambahan saldo...`);

            // 3. Jalankan logika tambah saldo (Sama dengan fungsi callback)
            const username_target = order.nama_user.trim().split(" ").pop();
            const method = order.metode_pembayaran; // VA atau QRIS
            const admin_fee = (method === "QRIS") ? Math.round(order.total_bayar * 0.008) : 2500;
            const net_amount = order.total_bayar - admin_fee;

            const formdata = new FormData();
            formdata.append("amount", net_amount);
            formdata.append("username", username_target);
            formdata.append("note", `Sync ${partner_reff} via ${method}`);

            try {
                await axios.post('https://linku.co.id/qris.php', formdata, {
                    headers: formdata.getHeaders()
                });

                // 4. Update status ke PAID di DB
                await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);
                logToFile(`✅ Sync Sukses: ${username_target} mendapatkan saldo.`);

                return res.json({ current_status: 'PAID', linkqu_response: linkquStatus });
            } catch (e) {
                logToFile(`❌ Gagal Sync Saldo: ${e.message}`);
                return res.json({ current_status: 'PENDING', message: "Pembayaran lunas di LinkQu tapi gagal tambah saldo ke web utama." });
            }
        }

        // Jika memang belum bayar
        res.json({
            current_status: 'PENDING',
            linkqu_response: linkquStatus
        });

    } catch (err) {
        logToFile(`❌ Check Status API Error: ${err.message}`);
        res.status(500).json({ error: "Gagal cek status ke LinkQu", detail: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));