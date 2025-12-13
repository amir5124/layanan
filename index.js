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

function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}\n`;
    fs.appendFile(logPath, fullMessage, (err) => {
        if (err) console.error("❌ Gagal menulis log:", err);
    });
}


function getExpiredTimestamp(minutesFromNow = 15) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}


// 🔐 Fungsi membuat signature untuk request POST VA
function generateSignaturePOST({
    amount,
    expired,
    bank_code,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    const path = '/transaction/create/va';
    const method = 'POST';

    const rawValue = amount + expired + bank_code + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

function generateSignatureQRIS({
    amount,
    expired,
    partner_reff,
    customer_id,
    customer_name,
    customer_email,
    clientId,
    serverKey
}) {
    const path = '/transaction/create/qris';
    const method = 'POST';

    const rawValue = amount + expired + partner_reff +
        customer_id + customer_name + customer_email + clientId;
    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

    const signToString = path + method + cleaned;

    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}



// 🧾 Fungsi membuat kode unik partner_reff
function generatePartnerReff() {
    const prefix = 'INV-';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${randomStr}`;
}

const uploadFields = upload.fields([{ name: 'ktp', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);


// ✅ Endpoint POST untuk membuat VA
// 1. CREATE VA (Final & Sinkron dengan Frontend)
// 1. CREATE VA (Tanpa Database)
app.post('/create-va', uploadFields, async (req, res) => {
    try {
        logToFile("📩 Request VA (Direct) Masuk");

        // Ambil data dari req.body (Multipart/FormData)
        const {
            nama, email, amount, method
        } = req.body;

        // Validasi input minimal
        if (!amount || !method || !nama) {
            return res.status(400).json({ error: "Nama, Amount, dan Method wajib diisi" });
        }

        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp(1440); // 24 Jam
        const finalEmail = (email && email.trim() !== "") ? email : "linkutransport@gmail.com";

        // Generate Signature sesuai pola objek Anda
        const signature = generateSignaturePOST({
            amount: amount,
            expired: expired,
            bank_code: method,       // Kode bank (014, 008, dll)
            partner_reff: partner_reff,
            customer_id: nama,
            customer_name: nama,
            customer_email: finalEmail,
            clientId: clientId,
            serverKey: serverKey
        });

        // Payload API LinkQu
        const payload = {
            amount: amount,
            bank_code: method,
            partner_reff: partner_reff,
            username: username,
            pin: pin,
            expired: expired,
            signature: signature,
            customer_id: nama,
            customer_name: nama,
            customer_email: finalEmail,
            url_callback: "https://topuplinku.siappgo.id/callback"
        };

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret,
            'Content-Type': 'application/json'
        };

        logToFile(`📤 Menembak API LinkQu VA: ${partner_reff}`);

        const response = await axios.post('https://api.linkqu.id/linkqu-partner/transaction/create/va', payload, { headers });

        logToFile(`✅ LinkQu Response: ${JSON.stringify(response.data)}`);

        // Kirim response LinkQu langsung ke frontend
        res.json(response.data);

    } catch (err) {
        const errorDetail = err.response?.data || err.message;
        logToFile(`❌ VA Error: ${JSON.stringify(errorDetail)}`);
        res.status(500).json({
            error: "Gagal membuat VA",
            detail: errorDetail
        });
    }
});

app.post('/create-qris', async (req, res) => {
    try {
        const body = req.body;
        console.log("📥 Incoming request body:", body);

        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const url_callback = "https://topuplinku.siappgo.id/callback";

        console.log("🧾 Generated partner_reff:", partner_reff);
        console.log("⏳ Expired timestamp:", expired);

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: body.customer_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId,
            serverKey
        });

        console.log("🔏 Generated signature:", signature);

        const payload = {
            ...body,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            url_callback
        };

        console.log("📦 Final payload to API:", payload);

        const headers = {
            'client-id': clientId,
            'client-secret': clientSecret
        };

        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/qris';
        const response = await axios.post(url, payload, { headers });

        const result = response.data;
        console.log("✅ API response from LinkQu:", result);

        // 💾 Download QR image langsung
        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                console.log(`🌐 Downloading QR image from: ${result.imageqris}`);
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisImageBuffer = Buffer.from(imgResp.data);
                console.log("✅ QR image downloaded successfully");
            } catch (err) {
                console.error("⚠️ Failed to download QRIS image:", err.message);
            }
        }

        // 🕒 Gunakan waktu lokal server, bukan UTC
        const now = new Date();
        const mysqlDateTime = now.toISOString().slice(0, 19).replace('T', ' ');

        const insertQuery = `
            INSERT INTO inquiry_qris 
            (partner_reff, customer_id, customer_name, amount, expired, customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `;

        await db.execute(insertQuery, [
            partner_reff,
            body.customer_id,
            body.customer_name,
            body.amount,
            expired,
            body.customer_phone || null,
            body.customer_email,
            result?.imageqris || null,
            qrisImageBuffer,
            JSON.stringify(result),
            mysqlDateTime
        ]);

        console.log(`✅ Data QRIS berhasil disimpan ke database dengan created_at = ${mysqlDateTime}`);
        res.json(result);

    } catch (err) {
        const errMsg = err.response?.data?.message || err.message;
        const logMsg = `❌ Gagal membuat QRIS: ${errMsg}`;
        console.error(logMsg);

        if (err.response?.data) {
            console.error("📛 Full error response from API:", err.response.data);
        }

        logToFile(logMsg);

        res.status(500).json({
            error: "Gagal membuat QRIS",
            detail: err.response?.data || err.message
        });
    }
});

// --- ENDPOINTS ---




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