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

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WA_NUMBER = 'whatsapp:+62882005447472';
const ADMIN_WA = 'whatsapp:+6282323907426';
const CS_NUMBER = '082226666610';

const twilioClient = new twilio(TWILIO_SID, TWILIO_AUTH);

const clientId = "5f5aa496-7e16-4ca1-9967-33c768dac6c7";
const clientSecret = "TM1rVhfaFm5YJxKruHo0nWMWC";
const username = "LI9019VKS";
const pin = "5m6uYAScSxQtCmU";
const serverKey = "QtwGEr997XDcmMb1Pq8S5X1N";

const DEFAULT_EMAIL = 'linkutransport@gmail.com';

const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: DEFAULT_EMAIL, pass: 'qbckptzxgdumxtdm' },
    tls: { rejectUnauthorized: true }
});

const BANK_MAP = { "014": "VA BCA", "008": "VA Mandiri", "009": "VA BNI", "002": "VA BRI", "QRIS": "QRIS" };

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

function isValidEmail(email) {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
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

// --- MODIFIKASI: Menambahkan parameter attachments ---
async function sendInvoiceEmail(toEmail, data, isPaid = false, attachments = []) {
    const targetEmail = isValidEmail(toEmail) ? toEmail : DEFAULT_EMAIL;
    const bankName = BANK_MAP[data.method] || data.method;
    const subject = isPaid ? `[LUNAS] Pembayaran Berhasil ${data.partner_reff}` : `Tagihan Pembayaran ${data.partner_reff}`;

    const mailOptions = {
        from: `"Indosat Ooredoo Payment" <${DEFAULT_EMAIL}>`,
        to: targetEmail,
        subject: subject,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #24b3ae; text-align: center;">${isPaid ? "Konfirmasi Pembayaran Lunas" : "Invoice Tagihan"}</h2>
                <p>Halo <b>${data.nama}</b>,</p>
                <p>Status: <span style="font-weight:bold; color:${isPaid ? '#28a745' : '#ffc107'}">${isPaid ? "Pembayaran Diterima" : "Menunggu Pembayaran"}</span></p>
                <hr>
                <p><b>Item:</b> ${data.item}<br>
                   <b>Total:</b> Rp${parseInt(data.amount).toLocaleString('id-ID')}<br>
                   <b>Metode:</b> ${bankName}</p>
                ${data.catatan ? `<p><b>Catatan:</b> ${data.catatan}</p>` : ''}
                <div style="background: #f4f4f4; padding: 15px; text-align: center;">
                    <span style="font-size: 12px;">${isPaid ? 'ID REFERENSI' : 'KODE BAYAR / VA'}:</span><br>
                    <b style="font-size: 20px; color: #333;">${data.paymentCode}</b>
                </div>
                <hr>
                <p style="text-align:center; font-size:12px;">Butuh bantuan? Hubungi CS: <b>${CS_NUMBER}</b></p>
            </div>`,
        attachments: attachments // Tambahkan lampiran
    };
    try { await transporter.sendMail(mailOptions); } catch (e) { logToFile(`Email Error: ${e.message}`); }
}

// ==========================================
// 🚀 API ENDPOINTS
// ==========================================

app.post('/create-va', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, method, biayaAdmin, catatan } = req.body;
        const nomorHp = formatWhatsApp(req.body.nomorHp);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440);
        const finalEmail = isValidEmail(email) ? email : DEFAULT_EMAIL;

        const ktpBuffer = req.files['ktp'] ? req.files['ktp'][0].buffer : null;
        const selfieBuffer = req.files['selfie'] ? req.files['selfie'][0].buffer : null;

        const rawSignature = amount + expired + method + partner_reff + nama + nama + finalEmail + clientId;
        const signature = crypto.createHmac("sha256", serverKey).update('/transaction/create/vaPOST' + rawSignature.replace(/[^0-9a-zA-Z]/g, "").toLowerCase()).digest("hex");

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', {
            amount, bank_code: method, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://indosat.siappgo.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(`INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, virtual_account, waktu_expired, status_pembayaran, foto_ktp, foto_selfie, catatan) VALUES (?,?,?,?,?,?,?,?,?, 'VA',?,?,?,?, 'PENDING', ?, ?, ?)`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, email, method, partner_reff, response.data.virtual_account, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss'), ktpBuffer, selfieBuffer, catatan || null]);

        await sendInvoiceEmail(email, { nama, item, amount, method, partner_reff, paymentCode: response.data.virtual_account, catatan }, false, []);
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/create-qris', uploadFields, async (req, res) => {
    try {
        const { nama, email, nik, kk, item, amount, biayaAdmin, catatan } = req.body;
        const nomorHp = formatWhatsApp(req.body.nomorHp);
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(30);
        const finalEmail = isValidEmail(email) ? email : DEFAULT_EMAIL;

        const ktpBuffer = req.files['ktp'] ? req.files['ktp'][0].buffer : null;
        const selfieBuffer = req.files['selfie'] ? req.files['selfie'][0].buffer : null;

        const rawSignature = amount + expired + partner_reff + nama + nama + finalEmail + clientId;
        const signature = crypto.createHmac("sha256", serverKey).update('/transaction/create/qrisPOST' + rawSignature.replace(/[^0-9a-zA-Z]/g, "").toLowerCase()).digest("hex");

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/qris', {
            amount, partner_reff, username, pin, expired, signature,
            customer_id: nama, customer_name: nama, customer_email: finalEmail,
            url_callback: "https://indosat.siappgo.id/callback"
        }, { headers: { 'client-id': clientId, 'client-secret': clientSecret } });

        await db.execute(`INSERT INTO orders (nama_paket, harga_paket, biaya_admin, total_bayar, nama_user, nomor_hp, nik, nomor_kk, email, metode_pembayaran, kode_bank, partner_reff, qris_image_url, waktu_expired, status_pembayaran, foto_ktp, foto_selfie, catatan) VALUES (?,?,?,?,?,?,?,?,?, 'QRIS', 'QRIS',?,?,?, 'PENDING', ?, ?, ?)`,
            [item, (amount - biayaAdmin), biayaAdmin, amount, nama, nomorHp, nik, kk, email, partner_reff, response.data.imageqris, moment(expired, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss'), ktpBuffer, selfieBuffer, catatan || null]);

        await sendInvoiceEmail(email, { nama, item, amount, method: 'QRIS', partner_reff, paymentCode: 'Scan QR di Aplikasi', catatan }, false, []);
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/view-file/:type/:partnerReff', async (req, res) => {
    try {
        const column = req.params.type === 'ktp' ? 'foto_ktp' : 'foto_selfie';
        const [rows] = await db.execute(`SELECT ${column} FROM orders WHERE partner_reff = ?`, [req.params.partnerReff]);
        if (rows.length === 0 || !rows[0][column]) return res.status(404).send("File tidak ditemukan");
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(rows[0][column]);
    } catch (err) { res.status(500).send("Error"); }
});

// --- MODIFIKASI FUNGSI CALLBACK ---
app.post('/callback', async (req, res) => {
    logToFile(`📩 Callback: ${JSON.stringify(req.body)}`);
    try {
        // Ambil 'username' dari body callback LinkQu
        const { partner_reff, status, amount, username: callbackUsername } = req.body;

        if (status === 'SUCCESS' || status === 'SETTLED') {
            // Ambil SEMUA data order, termasuk foto_ktp dan foto_selfie
            const [rows] = await db.execute("SELECT * FROM orders WHERE partner_reff = ? AND status_pembayaran = 'PENDING'", [partner_reff]);

            if (rows.length > 0) {
                const order = rows[0];
                await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [partner_reff]);

                const formattedAmount = `Rp${parseInt(amount).toLocaleString('id-ID')}`;

                // Siapkan data email dasar
                const emailData = {
                    nama: order.nama_user, item: order.nama_paket, amount: amount,
                    method: order.kode_bank, partner_reff: partner_reff, paymentCode: partner_reff, catatan: order.catatan
                };

                // --- 1. KIRIM EMAIL KE PENGGUNA (Invoice Lunas Saja) ---
                await sendInvoiceEmail(order.email, emailData, true, []);

                // --- 2. KIRIM EMAIL KE ADMIN (DENGAN LAMPIRAN KTP & SELFIE) ---
                const adminAttachments = [];
                if (order.foto_ktp) {
                    adminAttachments.push({ filename: `KTP_${order.partner_reff}.jpg`, content: order.foto_ktp, contentType: 'image/jpeg' });
                }
                if (order.foto_selfie) {
                    adminAttachments.push({ filename: `SELFIE_${order.partner_reff}.jpg`, content: order.foto_selfie, contentType: 'image/jpeg' });
                }

                await sendInvoiceEmail(DEFAULT_EMAIL, emailData, true, adminAttachments);


                // --- 3. KIRIM KE USER (ContentSid User) ---
                try {
                    await twilioClient.messages.create({
                        from: TWILIO_WA_NUMBER,
                        to: `whatsapp:+${order.nomor_hp}`,
                        contentSid: 'HXe14f3da1c838a88828c64f8bee9e4db5',
                        contentVariables: JSON.stringify({
                            "1": order.nama_user, "2": order.nama_paket, "3": formattedAmount, "4": partner_reff
                        })
                    });
                    // Manual message info CS
                    await twilioClient.messages.create({
                        from: TWILIO_WA_NUMBER,
                        to: `whatsapp:+${order.nomor_hp}`,
                        body: `Jika ada kendala, hubungi CS kami di wa.me/${CS_NUMBER.replace(/^0/, '62')}`
                    });
                } catch (e) { logToFile(`WA User Error: ${e.message}`); }

                // --- 4. KIRIM KE ADMIN (Hanya Template Teks, Tanpa Foto) ---
                try {
                    // Siapkan Content Variables dengan variabel ke-9 (username) untuk mencegah error
                    const adminContentVars = JSON.stringify({
                        "1": order.nama_user, "2": order.nomor_hp, "3": order.nik, "4": order.nomor_kk,
                        "5": order.nama_paket, "6": formattedAmount, "7": partner_reff,
                        "8": order.catatan || "-"

                    });

                    await twilioClient.messages.create({
                        from: TWILIO_WA_NUMBER,
                        to: ADMIN_WA,
                        contentSid: 'HX74dbb58641dde0f70da9437461c09723',
                        contentVariables: adminContentVars,
                        // TIDAK ADA mediaUrl, sesuai permintaan
                    });
                } catch (e) { logToFile(`WA Admin Error: ${e.message}`); }
            }
        }
        res.status(200).send("OK");
    } catch (err) { res.status(500).send("Error"); }
});

app.get('/check-status/:partnerReff', async (req, res) => {
    try {
        const response = await axios.get(`https://api.linkqu.id/linkqu-partner/transaction/payment/checkstatus`, {
            params: { username, partnerreff: req.params.partnerReff },
            headers: { 'client-id': clientId, 'client-secret': clientSecret }
        });
        if (response.data.status === 'SUCCESS') {
            const [check] = await db.execute("SELECT status_pembayaran FROM orders WHERE partner_reff = ?", [req.params.partnerReff]);
            if (check[0].status_pembayaran !== 'PAID') {
                await db.execute("UPDATE orders SET status_pembayaran = 'PAID' WHERE partner_reff = ?", [req.params.partnerReff]);
            }
        }
        res.json(response.data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/download-qr/:partnerReff', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT qris_image_url FROM orders WHERE partner_reff = ?", [req.params.partnerReff]);
        if (rows.length === 0) return res.status(404).send("Not Found");
        const img = await axios({ url: rows[0].qris_image_url, method: 'GET', responseType: 'arraybuffer' });
        res.setHeader('Content-Type', 'image/png');
        res.send(img.data);
    } catch (err) { res.status(500).send("Error"); }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));