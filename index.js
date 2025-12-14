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
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 🔐 KONFIGURASI KREDENSIAL
// ==========================================

// Twilio (Gunakan format whatsapp:+ nomor)
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxxxxxxxxxx';
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN || 'xxxxxxxxxxxxxxxx';
const TWILIO_WA_NUMBER = 'whatsapp:+62882005447472'; // Ganti dengan nomor Twilio Anda
const twilioClient = new twilio(TWILIO_SID, TWILIO_AUTH);

// LinkQu
const clientId = "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = "LI9019VKS";
const pin = "5m6uYAScSxQtCmU";
const serverKey = "QtwGEr997XDcmMb1Pq8S5X1N";

// Database
const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

// Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'linkutransport@gmail.com',
        pass: 'qbckptzxgdumxtdm',
    },
    tls: { rejectUnauthorized: true }
});

// Multer
const upload = multer({ storage: multer.memoryStorage() });
const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================

function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    console.log(`[${timestamp}] ${message}`);
}

function formatWhatsApp(phone) {
    if (!phone) return "";
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return cleaned;
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    return `INV-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function sendInvoiceEmail(toEmail, data) {
    const mailOptions = {
        from: '"Indosat Ooredoo Payment" <linkutransport@gmail.com>',
        to: toEmail,
        subject: `Tagihan Pembayaran ${data.partner_reff}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #24b3ae;">Invoice Tagihan</h2>
                <p>Halo <b>${data.nama}</b>,</p>
                <p>Detail pesanan Anda:</p>
                <p><b>Item:</b> ${data.item}<br><b>Total:</b> Rp${parseInt(data.amount).toLocaleString('id-ID')}<br><b>Metode:</b> ${data.method}</p>
                <div style="background: #f4f4f4; padding: 15px; text-align: center;">
                    <span style="font-size: 12px;">KODE BAYAR / VA:</span><br>
                    <b style="font-size: 20px; color: #333;">${data.paymentCode}</b>
                </div>
            </div>`
    };
    try { await transporter.sendMail(mailOptions); } catch (e) { logToFile(`Email Error: ${e.message}`); }
}

// ==========================================
// 🚀 API ENDPOINTS
// ==========================================

// 1. CREATE VA
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, method, biayaAdmin } = req.body;
        const nomorHp = formatWhatsApp(req.body.nomorHp);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440);
        const finalEmail = email || "linkutransport@gmail.com";

        const rawSignature = amount + expired + method + partner_reff + nama + nama + finalEmail + clientId;
        const signature = crypto.createHmac("sha256", serverKey).update('/transaction/create/vaPOST' + rawSignature.replace(/[^0-9a-zA-Z]/g, "").toLowerCase()).digest("hex");

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', {
            amount, bank_code: method, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://indosat.siappgo.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(`INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran) VALUES (?,?,?,?,?,?,?,?,?, 'VA',?,?,?,?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, finalEmail, method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]);

        await sendInvoiceEmail(finalEmail, { nama, item, amount, method, partner_reff, paymentCode: response.data.virtual_account });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. CREATE QRIS
app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, biayaAdmin } = req.body;
        const nomorHp = formatWhatsApp(req.body.nomorHp);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30);
        const finalEmail = email || "linkutransport@gmail.com";

        const rawSignature = amount + expired + partner_reff + nama + nama + finalEmail + clientId;
        const signature = crypto.createHmac("sha256", serverKey).update('/transaction/create/qrisPOST' + rawSignature.replace(/[^0-9a-zA-Z]/g, "").toLowerCase()).digest("hex");

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', {
            amount, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://indosat.siappgo.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(`INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran) VALUES (?,?,?,?,?,?,?,?,?, 'QRIS', 'QRIS',?,?,?, 'PENDING')`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, finalEmail, partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss')]);

        await sendInvoiceEmail(finalEmail, { nama, item, amount, method: 'QRIS', partner_reff, paymentCode: 'Scan QR di Aplikasi' });
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. CALLBACK (OTOMATIS WHATSAPP NOTIF)
app.post('/callback', async (req, res) => {
    logToFile(`📩 Callback: ${JSON.stringify(req.body)}`);
    try {
        const { partner_reff, status, amount } = req.body;
        if (status === 'SUCCESS' || status === 'SETTLED') {
            const [rows] = await db.execute("SELECT nama_user, nomor_hp, nama_paket FROM orders WHERE partner_reff = ? AND status_pembayaran = 'PENDING'", [partner_reff]);

            if (rows.length > 0) {
                const order = rows[0];
                await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [partner_reff]);

                // Kirim WhatsApp Twilio
                try {
                    await twilioClient.messages.create({
                        from: TWILIO_WA_NUMBER,
                        to: `whatsapp:+${order.nomor_hp}`,
                        body: `✅ PEMBAYARAN BERHASIL!\n\nHalo ${order.nama_user},\nPembayaran untuk ${order.nama_paket} sebesar Rp${parseInt(amount).toLocaleString('id-ID')} telah kami terima.\n\nStatus: SELESAI\nNo. Invoice: ${partner_reff}\n\nTerima kasih telah menggunakan layanan kami.`
                    });
                } catch (waErr) { logToFile(`WA Error: ${waErr.message}`); }
            }
        }
        res.status(200).send("OK");
    } catch (err) { res.status(500).send("Error"); }
});

// 4. CHECK STATUS MANUAL
app.get('/check-status/:partnerReff', async (req, res) => {
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: req.params.partnerReff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });
        if (response.data.status === 'SUCCESS') {
            await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [req.params.partnerReff]);
        }
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. DOWNLOAD QRIS
app.get('/download-qr/:partnerReff', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT qris_image_url FROM orders WHERE partner_reff = ?", [req.params.partnerReff]);
        if (rows.length === 0) return res.status(404).send("Not Found");
        const img = await axios({ url: rows[0].qris_image_url, method: 'GET', responseType: 'arraybuffer' });
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename=QRIS-${req.params.partnerReff}.png`);
        res.send(img.data);
    } catch (err) { res.status(500).send("Error"); }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));