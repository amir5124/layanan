require('dotenv').config(); // Load variabel dari .env
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// --- KONFIGURASI MULTER (FOTO) ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// --- KREDENSIAL ---
const clientId = "685c857c-8edb-4a3c-a800-c27980d23216";
const clientSecret = "ZQ6G4Ry1yYRTLp3M1MEdKRHEa";
const username = "LI504NUNN";
const pin = "Ag7QKv4ZAnOeliF";
const serverKey = "Io5cT4CBgI5GZY3TEI2hgelk";

// Twilio dari .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);
const twilioFrom = 'whatsapp:+62882005447472';
const ADMIN_PHONE = '6282323907426';

// Email Default
const DEFAULT_EMAIL = 'linkutransport@gmail.com';
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: 'linkutransport@gmail.com', pass: 'qbckptzxgdumxtdm' }
});

// Database
const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

// --- UTILITY ---
const formatIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);

/** Format nomor HP user ke format internasional WhatsApp */
function formatWA(number) {
    if (!number) return '';
    let cleaned = number.toString().replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return `whatsapp:+${cleaned}`;
}

function generateSignature(data, path) {
    const method = 'POST';
    const paramsOrder = path.includes('/va')
        ? ['amount', 'expired', 'bank_code', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId']
        : ['amount', 'expired', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId'];

    let rawValue = paramsOrder.map(key => data[key] || '').join('');
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    return crypto.createHmac("sha256", serverKey).update(path + method + cleaned).digest("hex");
}

async function sendEmailNotification(to, data, isPaid = false) {
    const color = isPaid ? '#24b3ae' : '#e63946';
    const statusLabel = isPaid ? 'PEMBAYARAN BERHASIL' : 'TAGIHAN PEMBAYARAN';
    const htmlContent = `
    <div style="font-family:sans-serif; max-width:500px; border:1px solid #eee; padding:20px; border-radius:15px;">
        <div style="background:${color}; color:white; padding:10px; text-align:center; border-radius:10px; font-weight:bold;">${statusLabel}</div>
        <h3>Halo, ${data.nama_user}</h3>
        <p>${isPaid ? 'Terima kasih, pembayaran telah kami terima.' : 'Segera selesaikan pembayaran paket data Anda.'}</p>
        <table style="width:100%; border-top:1px solid #eee; padding-top:10px;">
            <tr><td>Invoice</td><td align="right">#${data.partner_reff}</td></tr>
            <tr><td>Paket</td><td align="right">${data.nama_paket}</td></tr>
            <tr><td>Total</td><td align="right"><b>${formatIDR(data.total_bayar)}</b></td></tr>
        </table>
    </div>`;
    return transporter.sendMail({ from: '"Indosat Care" <linkutransport@gmail.com>', to, subject: `[${statusLabel}] #${data.partner_reff}`, html: htmlContent });
}

// --- ENDPOINTS ---

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        let { nama, email, nik, kk, item, amount, method, biayaAdmin, nomorHp } = req.body;
        const finalEmail = (email && email.trim() !== "") ? email : DEFAULT_EMAIL;

        const ktpBuffer = req.files['ktp'] ? req.files['ktp'][0].buffer : null;
        const selfieBuffer = req.files['selfie'] ? req.files['selfie'][0].buffer : null;

        const partner_reff = `INV-VA-${Date.now()}`;
        const rawExpired = moment().tz('Asia/Jakarta').add(24, 'hours');
        const expiredLinkQu = rawExpired.format('YYYYMMDDHHmmss');

        const sigData = { amount, expired: expiredLinkQu, bank_code: method, partner_reff, customer_id: nama, customer_name: nama, customer_email: finalEmail, clientId };
        const signature = generateSignature(sigData, '/transaction/create/va');

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', {
            amount, bank_code: method, partner_reff, username, pin, expired: expiredLinkQu, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail, url_callback: "https://layanan.linku.co.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, ktpBuffer, selfieBuffer, finalEmail, 'VA', method, partner_reff, response.data.virtual_account, rawExpired.format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json({ ...response.data, partner_reff, expired: expiredLinkQu });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        let { nama, email, nik, kk, item, amount, biayaAdmin, nomorHp } = req.body;
        const finalEmail = (email && email.trim() !== "") ? email : DEFAULT_EMAIL;

        const ktpBuffer = req.files['ktp'] ? req.files['ktp'][0].buffer : null;
        const selfieBuffer = req.files['selfie'] ? req.files['selfie'][0].buffer : null;

        const partner_reff = `INV-QR-${Date.now()}`;
        const rawExpired = moment().tz('Asia/Jakarta').add(30, 'minutes');
        const expiredLinkQu = rawExpired.format('YYYYMMDDHHmmss');

        const sigData = { amount, expired: expiredLinkQu, partner_reff, customer_id: nama, customer_name: nama, customer_email: finalEmail, clientId };
        const signature = generateSignature(sigData, '/transaction/create/qris');

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', {
            amount, partner_reff, username, pin, expired: expiredLinkQu, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail, url_callback: "https://layanan.linku.co.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(
            `INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, foto_ktp, foto_selfie, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, ktpBuffer, selfieBuffer, finalEmail, 'QRIS', 'QRIS', partner_reff, response.data.imageqris, rawExpired.format('YYYY-MM-DD HH:mm:ss')]
        );

        res.json({ ...response.data, partner_reff, expired: expiredLinkQu });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. CALLBACK
app.post('/callback', async (req, res) => {
    const { partner_reff } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        const order = rows[0];
        if (!order || order.status_pembayaran === 'PAID') return res.json({ status: 'OK' });

        await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);

        await sendEmailNotification(order.email, order, true);

        // Notifikasi WA Customer
        const waVar = {
            "1": order.nama_user,
            "2": partner_reff,
            "3": order.nama_paket,
            "4": "AKTIF/SUKSES",
            "5": moment().format('DD/MM/YY'),
            "6": moment().format('HH:mm'),
            "7": formatIDR(order.total_bayar)
        };

        try {
            await twilioClient.messages.create({
                from: twilioFrom,
                to: formatWA(order.nomor_hp),
                contentSid: 'HX83d2f6ce8fa5693a942935bb0f44a77d',
                contentVariables: JSON.stringify(waVar)
            });
        } catch (e) { console.error("Gagal kirim WA Customer"); }

        // Notifikasi WA Admin
        const msgAdmin = `✅ *PAYMENT LUNAS*\n\nInv: ${partner_reff}\nUser: ${order.nama_user}\nPaket: ${order.nama_paket}\nNIK: ${order.nik}\nKK: ${order.nomor_kk}\nTotal: ${formatIDR(order.total_bayar)}`;
        try {
            await twilioClient.messages.create({
                from: twilioFrom,
                to: formatWA(ADMIN_PHONE),
                body: msgAdmin
            });
        } catch (e) { console.error("Gagal kirim WA Admin"); }

        res.json({ status: 'SUCCESS' });
    } catch (err) { res.status(500).send(err.message); }
});

// 4. CHECK STATUS
app.get('/check-status/:partnerReff', async (req, res) => {
    const partner_reff = req.params.partnerReff;
    try {
        const [rows] = await db.query('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
        const orderData = rows[0];
        if (!orderData) return res.status(404).json({ error: "Order tidak ditemukan." });
        if (orderData.status_pembayaran === 'PAID') return res.json({ partner_reff, current_status: 'PAID' });

        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: partner_reff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });

        const isSuccess = response.data.status_code === '00' || response.data.status === 'SUKSES';
        if (isSuccess) {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID', updated_at = NOW() WHERE partner_reff = ?", [partner_reff]);
        }
        res.json({ partner_reff, current_status: isSuccess ? 'PAID' : 'PENDING' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Berjalan di Port ${PORT}`));