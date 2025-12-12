const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer'); // 📧 Modul Email
const twilio = require('twilio'); // 📱 Modul WhatsApp/Twilio

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Konfigurasi Kredensial Umum
const clientId = "088e21fc-de14-4df5-9008-f545ecd28ad1";
const clientSecret = "p8OOlsOexX5AdDSOgHx1y65Bw";
const username = "LI264GULM";
const pin = "bCY3o1jPJe1JHcI";
const serverKey = "AArMxIUKKz8WZfzdSXcILkiy";

// ADMIN NUMBER (Nomor Admin yang diminta)
const ADMIN_PHONE = '6282323907426';

// 📧 Konfigurasi Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,         // <-- UBAH KE PORT 587
    secure: false,     // <-- UBAH KE FALSE
    auth: {
        user: 'linkutransport@gmail.com',
        pass: 'qbckptzxgdumxtdm',
    },
    tls: {
        // Ketika secure: false dan port: 587, NodeMailer akan otomatis menggunakan STARTTLS
        rejectUnauthorized: true,
    },
});

// 📱 Konfigurasi Twilio
const accountSid = "AC24e2bb8c03641bf91e18f0ba265cb639";
const authToken = "fa7057054f2b50cce17e11de70fc67d4";
const twilioClient = twilio(accountSid, authToken);
const twilioFrom = 'whatsapp:+62882005447472'; // Nomor WhatsApp bisnis Anda

// 🐘 Konfigurasi Database
const db = mysql.createPool({
    host: '203.161.184.103',
    user: 'kilaugr1_layanan',
    password: '~)ea$[r179HegfyL',
    database: 'kilaugr1_layanan',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- FUNGSI UTILITY ---

// 📝 Fungsi untuk menulis log ke stderr.log
function logToFile(message) {
    const logPath = path.join(__dirname, 'stderr.log');
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}] ${message}\n`;
    fs.appendFile(logPath, fullMessage, (err) => {
        if (err) {
            console.error("❌ Gagal menulis log:", err);
        }
    });
}

// 🔄 FUNGSI UTILITY BARU: Mengubah expired menjadi 1 hari (1440 menit)
function getExpiredTimestamp(minutesFromNow = 1440) {
    return moment.tz('Asia/Jakarta').add(minutesFromNow, 'minutes').format('YYYYMMDDHHmmss');
}

// 🔐 Fungsi membuat signature (VA/QRIS)
function generateSignaturePOST(data, path) {
    const method = 'POST';
    const paramsOrder = path.includes('/va') ? ['amount', 'expired', 'bank_code', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId'] :
        path.includes('/qris') ? ['amount', 'expired', 'partner_reff', 'customer_id', 'customer_name', 'customer_email', 'clientId'] :
            [];

    let rawValue = paramsOrder.map(key => data[key] || '').join('');

    const cleaned = rawValue.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const signToString = path + method + cleaned;
    return crypto.createHmac("sha256", serverKey).update(signToString).digest("hex");
}

// 🧾 Fungsi membuat kode unik partner_reff
function generatePartnerReff() {
    const prefix = 'INV';
    const timestamp = moment().tz('Asia/Jakarta').format('YYYYMMDDHHmmss');
    const randomStr = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${randomStr}`;
}

// ------------------------------------
// 📧 FUNGSI EMAIL (NODEMAILER)
// ------------------------------------

async function sendEmailNotification(to, subject, htmlContent) {
    try {
        const info = await transporter.sendMail({
            from: 'linkutransport@gmail.com',
            to: to,
            subject: subject,
            html: htmlContent,
        });
        console.log("✅ Email terkirim: %s", info.messageId);
        return { status: true, messageId: info.messageId };
    } catch (error) {
        console.error("❌ Gagal mengirim email ke %s:", to, error.message);
        logToFile(`❌ Gagal mengirim email ke ${to}: ${error.message}`);
        return { status: false, error: error.message };
    }
}

// 📧 FUNGSI EMAIL INVOICE/PENDING (TangerangFast) - TIDAK ADA PERUBAHAN
function createInvoiceEmailHTML(order, transaction) {
    const formatIDR = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

    const paymentDetails = transaction.va_number ? `
        <tr><td>Bank</td><td>: ${transaction.bank_name}</td></tr>
        <tr><td>VA Number</td><td>: **${transaction.va_number}**</td></tr>
        <tr><td>Batas Waktu</td><td>: ${moment(transaction.expired, 'YYYYMMDDHHmmss').format('DD MMMM YYYY HH:mm:ss')} WIB</td></tr>
    ` : `
        <tr><td colspan="2">Silakan scan QRIS di bawah atau klik link berikut: <a href="${transaction.qris_url}">Link QRIS</a></td></tr>
        <tr><td>Batas Waktu</td><td>: ${moment(transaction.expired, 'YYYYMMDDHHmmss').format('DD MMMM YYYY HH:mm:ss')} WIB</td></tr>
    `;

    return `
        <html>
        <body>
            <center>
                <h2>TAGIHAN PEMBAYARAN JASA TANGERANGFAST</h2>
            </center>
            <hr>
            <p>Dear **${order.customer_name}**,</p>
            <p>Yuk, lanjutkan proses pembayaran Anda agar kami dapat segera menjadwalkan kunjungan teknisi andalan **TangerangFast**. Berikut informasi tagihan Anda:</p>
            
            <h4>Detail Pesanan</h4>
            <table border="0" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
                <tr><td>Nomor Invoice</td><td>: <b>${order.order_reff}</b></td></tr>
                <tr><td>Layanan</td><td>: ${order.service_name}</td></tr>
                <tr><td>Alamat Kunjungan</td><td>: ${order.address} (${order.building_type})</td></tr>
                <tr><td>Total Tagihan</td><td>: <span style="font-size: 1.2em; color: #dc3545;"><b>${formatIDR(order.total_amount)}</b></span></td></tr>
            </table>

            <h4>Metode Pembayaran (${order.payment_method})</h4>
            <table border="0" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
                ${paymentDetails}
            </table>
            
            <p>Mohon selesaikan pembayaran sebelum batas waktu yang ditentukan (1x24 Jam). Setelah pembayaran diverifikasi, kami akan segera mengirimkan konfirmasi dan detail mitra.</p>
            <br>
            <p>Salam Hangat,<br>**Tim TangerangFast**</p>
        </body>
        </html>
    `;
}

// 📧 FUNGSI EMAIL PAID/SUKSES (TangerangFast) - TIDAK ADA PERUBAHAN
function createSuccessEmailHTML(order) {
    const formatIDR = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

    return `
        <html>
        <body>
            <center>
                <h2>✅ PEMBAYARAN SUKSES DIKONFIRMASI OLEH TANGERANGFAST</h2>
            </center>
            <hr>
            <p>Yth. **${order.customer_name}**,</p>
            <p>Kami sangat senang memberitahukan bahwa pembayaran Anda sebesar <b>${formatIDR(order.total_amount)}</b> untuk pesanan layanan **${order.service_name}** (Invoice: **${order.order_reff}**) telah berhasil kami terima.</p>
            
            <h4>Langkah Selanjutnya: Penugasan Mitra Andalan</h4>
            <p>Tim **TangerangFast** sedang memproses penugasan mitra/teknisi andalan kami untuk kunjungan ke alamat Anda (**${order.address}**).</p>
            <p>Anda akan segera menerima **Email dan WhatsApp terpisah** berisi **detail lengkap Mitra** (nama dan kontak) serta **estimasi waktu kedatangan (ETA)**, segera setelah penugasan selesai.</p>
            
            <p>Terima kasih atas kepercayaan Anda menggunakan layanan **TangerangFast**. Kami menjamin pelayanan cepat dan terbaik!</p>
            <br>
            <p>Salam Hangat,<br>**Tim TangerangFast**</p>
        </body>
        </html>
    `;
}

// 📧 FUNGSI EMAIL ADMIN NOTIFIKASI SUKSES (BARU)
function createAdminSuccessEmailHTML(order) {
    const formatIDR = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);

    return `
        <html>
        <body>
            <center>
                <h2>💰 NOTIFIKASI PEMBAYARAN MASUK BARU - TANGERANGFAST</h2>
            </center>
            <hr>
            <p>Kepada Admin,</p>
            <p>Pembayaran baru telah berhasil dikonfirmasi oleh sistem. Segera proses penugasan mitra untuk pesanan ini:</p>
            
            <h4>Detail Pembayaran</h4>
            <table border="0" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
                <tr><td>Nomor Invoice</td><td>: <b>${order.order_reff}</b></td></tr>
                <tr><td>Total Dibayar</td><td>: <span style="font-size: 1.2em; color: #1e7e34;"><b>${formatIDR(order.total_amount)}</b></span></td></tr>
                <tr><td>Metode Bayar</td><td>: ${order.payment_method}</td></tr>
            </table>

            <h4>Detail Pelanggan & Layanan</h4>
            <table border="0" cellpadding="5" cellspacing="0" style="width: 100%; border-collapse: collapse;">
                <tr><td>Pelanggan</td><td>: ${order.customer_name}</td></tr>
                <tr><td>Telepon</td><td>: ${order.customer_phone}</td></tr>
                <tr><td>Layanan</td><td>: ${order.service_name}</td></tr>
                <tr><td>Lokasi/Alamat</td><td>: ${order.location} / ${order.address}</td></tr>
            </table>
            
            <p>Invoice status telah diubah menjadi **PAID**. Silakan lanjutkan ke proses alokasi mitra.</p>
        </body>
        </html>
    `;
}


// ------------------------------------
// 📱 FUNGSI WHATSAPP (TWILIO)
// ------------------------------------

function formatToWhatsAppNumber(localNumber) {
    if (typeof localNumber !== 'string') return null;
    const cleanNumber = localNumber.replace(/\D/g, '');
    if (cleanNumber.startsWith('0')) return `+62${cleanNumber.slice(1)}`;
    if (cleanNumber.startsWith('62')) return `+${cleanNumber}`;
    if (cleanNumber.startsWith('+62')) return `${cleanNumber}`;
    return null;
}

// 📱 FUNGSI WA PELANGGAN (Menggunakan ContentSid/Template WA)
async function sendWhatsAppCustomerSuccess(to, variables) {
    const formattedTo = formatToWhatsAppNumber(to);
    if (!formattedTo) {
        console.error('❌ Gagal mengirim WhatsApp: Nomor telepon tidak valid:', to);
        return { status: false, message: 'Nomor telepon tidak valid.' };
    }

    try {
        const response = await twilioClient.messages.create({
            from: twilioFrom,
            to: `whatsapp:${formattedTo}`,
            // Harap pastikan contentSid ini valid untuk template WhatsApp PAID/Sukses Anda
            contentSid: 'HX0b917865b218195db316f9379aed065a',
            contentVariables: JSON.stringify(variables),
        });
        console.log('✅ Pesan WhatsApp Customer berhasil dikirim:', response.sid);
        return { status: true, message: 'Pesan berhasil dikirim.', sid: response.sid };
    } catch (error) {
        console.error('❌ Gagal mengirim pesan WhatsApp Customer ke %s:', formattedTo, error.message);
        logToFile(`❌ Gagal mengirim WhatsApp Customer ke ${formattedTo}: ${error.message}`);
        return { status: false, message: error.message };
    }
}

// 📱 FUNGSI WA ADMIN (Menggunakan Body Text Standar) - BARU
async function sendWhatsAppAdminNotification(to, messageBody) {
    const formattedTo = formatToWhatsAppNumber(to);
    if (!formattedTo) {
        console.error('❌ Gagal mengirim WhatsApp Admin: Nomor telepon tidak valid:', to);
        return { status: false, message: 'Nomor telepon Admin tidak valid.' };
    }

    try {
        const response = await twilioClient.messages.create({
            from: twilioFrom,
            to: `whatsapp:${formattedTo}`,
            body: messageBody, // Menggunakan body teks karena notifikasi admin biasanya tidak perlu template
        });
        console.log('✅ Pesan WhatsApp Admin berhasil dikirim:', response.sid);
        return { status: true, message: 'Pesan berhasil dikirim.', sid: response.sid };
    } catch (error) {
        console.error('❌ Gagal mengirim pesan WhatsApp Admin ke %s:', formattedTo, error.message);
        logToFile(`❌ Gagal mengirim WhatsApp Admin ke ${formattedTo}: ${error.message}`);
        return { status: false, message: error.message };
    }
}


// ------------------------------------
// 🔄 FUNGSI CRUD INQUIRY/ORDER - TIDAK ADA PERUBAHAN
// ------------------------------------

async function insertOrderService(body, partnerReff) {
    const now = new Date();
    const [result] = await db.execute(
        `INSERT INTO order_service 
         (order_reff, customer_name, customer_phone, customer_email, service_name, service_price, location, address, building_type, building_fee, total_amount, payment_method, payment_code, order_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?)`,
        [
            partnerReff,
            body.kontak.nama,
            body.kontak.telepon,
            body.kontak.email,
            body.layanan.nama,
            body.layanan.harga,
            body.lokasi,
            body.alamat,
            body.jenisGedung,
            body.biayaGedung,
            body.totalBayar,
            body.metodePembayaran.name,
            body.metodePembayaran.code,
            now,
            now
        ]
    );
    return result.insertId;
}

async function getOrderDetails(partnerReff) {
    const [orderRows] = await db.query(
        'SELECT * FROM order_service WHERE order_reff = ?',
        [partnerReff]
    );
    return orderRows.length > 0 ? orderRows[0] : null;
}

async function getCurrentStatusVa(partnerReff) {
    try {
        const [rows] = await db.execute(
            'SELECT status FROM inquiry_va WHERE partner_reff = ?',
            [partnerReff]
        );
        return rows.length > 0 ? rows[0].status : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_va: ${error.message}`);
        throw error;
    }
}

async function getCurrentStatusQris(partnerReff) {
    try {
        const [rows] = await db.execute(
            'SELECT status FROM inquiry_qris WHERE partner_reff = ?',
            [partnerReff]
        );
        return rows.length > 0 ? rows[0].status : null;
    } catch (error) {
        console.error(`❌ Gagal cek status inquiry_qris: ${error.message}`);
        throw error;
    }
}


// ------------------------------------
// ⚡ ENDPOINT UTAMA
// ------------------------------------

// 1. ENDPOINT VA
app.post('/create-va', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        // Menggunakan FUNGSI getExpiredTimestamp() BARU (default 1440 menit/1 hari)
        const expired = getExpiredTimestamp();
        const url_callback = "https://layanan.kilaugroup.co.id/callback";

        // 1. SIMPAN DATA PESANAN KE order_service
        const orderServiceId = await insertOrderService(body, partner_reff);
        const orderData = await getOrderDetails(partner_reff);

        // --- LINKQU LOGIC ---
        const signature = generateSignaturePOST({
            amount: body.totalBayar,
            expired,
            bank_code: body.metodePembayaran.code,
            partner_reff,
            customer_id: body.kontak.nama,
            customer_name: body.kontak.nama,
            customer_email: body.kontak.email,
            clientId,
            serverKey
        }, '/transaction/create/va');

        const payload = {
            amount: body.totalBayar,
            bank_code: body.metodePembayaran.code,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            customer_id: body.kontak.nama,
            customer_name: body.kontak.nama,
            customer_email: body.kontak.email,
            url_callback
        };

        const headers = { 'client-id': clientId, 'client-secret': clientSecret };
        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/va';
        const response = await axios.post(url, payload, { headers });
        const result = response.data;
        // --- END LINKQU LOGIC ---

        // 2. SIMPAN DATA TRANSAKSI KE inquiry_va
        const insertData = {
            order_service_id: orderServiceId,
            partner_reff,
            customer_id: body.kontak.nama,
            amount: body.totalBayar,
            bank_name: result?.bank_name || body.metodePembayaran.name,
            expired,
            va_number: result?.virtual_account || null,
            response_raw: JSON.stringify(result),
            created_at: new Date(),
            status: "PENDING"
        };
        await db.query('INSERT INTO inquiry_va SET ?', [insertData]);

        // 3. KIRIM EMAIL INVOICE (TangerangFast)
        const emailContent = createInvoiceEmailHTML(orderData, {
            va_number: result?.virtual_account,
            bank_name: result?.bank_name || body.metodePembayaran.name,
            expired
        });
        await sendEmailNotification(orderData.customer_email, `Tagihan Pembayaran Pesanan ${orderData.order_reff} - TangerangFast (1x24 Jam)`, emailContent);

        // 4. UPDATE STATUS EMAIL
        await db.query(`UPDATE order_service SET email_status = 'CREATED' WHERE id = ?`, [orderServiceId]);

        res.json(result);
    } catch (err) {
        console.error("❌ Gagal membuat VA:", err.message);
        res.status(500).json({ error: "Gagal membuat VA", detail: err.response?.data || err.message });
    }
});


// 2. ENDPOINT QRIS
app.post('/create-qris', async (req, res) => {
    try {
        const body = req.body;
        const partner_reff = generatePartnerReff();
        // Menggunakan FUNGSI getExpiredTimestamp() BARU (default 1440 menit/1 hari)
        const expired = getExpiredTimestamp();
        const url_callback = "https://layanan.kilaugroup.co.id/callback";

        // 1. SIMPAN DATA PESANAN KE order_service
        const orderServiceId = await insertOrderService(body, partner_reff);
        const orderData = await getOrderDetails(partner_reff);

        // --- LINKQU LOGIC ---
        const signature = generateSignaturePOST({
            amount: body.totalBayar,
            expired,
            partner_reff,
            customer_id: body.kontak.nama,
            customer_name: body.kontak.nama,
            customer_email: body.kontak.email,
            clientId,
            serverKey
        }, '/transaction/create/qris');

        const payload = {
            amount: body.totalBayar,
            partner_reff,
            username,
            pin,
            expired,
            signature,
            customer_id: body.kontak.nama,
            customer_name: body.kontak.nama,
            customer_email: body.kontak.email,
            url_callback
        };

        const headers = { 'client-id': clientId, 'client-secret': clientSecret };
        const url = 'https://api.linkqu.id/linkqu-partner/transaction/create/qris';
        const response = await axios.post(url, payload, { headers });
        const result = response.data;
        // --- END LINKQU LOGIC ---

        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                // Download gambar untuk disimpan di database
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer' });
                qrisImageBuffer = Buffer.from(imgResp.data);
            } catch (err) {
                console.error("⚠️ Failed to download QRIS image:", err.message);
            }
        }

        // 2. SIMPAN DATA TRANSAKSI KE inquiry_qris
        const now = new Date();
        const mysqlDateTime = now.toISOString().slice(0, 19).replace('T', ' ');

        const insertQuery = `
            INSERT INTO inquiry_qris 
            (order_service_id, partner_reff, customer_id, amount, expired, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `;

        await db.execute(insertQuery, [
            orderServiceId,
            partner_reff,
            body.kontak.nama,
            body.totalBayar,
            expired,
            result?.imageqris || null,
            qrisImageBuffer,
            JSON.stringify(result),
            mysqlDateTime
        ]);

        // 3. KIRIM EMAIL INVOICE (TangerangFast)
        const emailContent = createInvoiceEmailHTML(orderData, {
            qris_url: result?.imageqris,
            expired
        });
        await sendEmailNotification(orderData.customer_email, `Tagihan Pembayaran Pesanan ${orderData.order_reff} - TangerangFast (1x24 Jam)`, emailContent);

        // 4. UPDATE STATUS EMAIL
        await db.query(`UPDATE order_service SET email_status = 'CREATED' WHERE id = ?`, [orderServiceId]);

        res.json(result);

    } catch (err) {
        console.error("❌ Gagal membuat QRIS:", err.message);
        res.status(500).json({ error: "Gagal membuat QRIS", detail: err.response?.data || err.message });
    }
});


// 3. CALLBACK (TITIK KONFIRMASI PEMBAYARAN)
app.post('/callback', async (req, res) => {
    const { partner_reff, amount, va_code, customer_name, serialnumber } = req.body;
    const logMsg = `✅ Callback diterima: ${JSON.stringify(req.body)}`;
    console.log(logMsg);
    logToFile(logMsg);

    try {
        let methodType;
        if (va_code === 'QRIS') {
            methodType = 'QRIS';
        } else {
            methodType = 'VA';
        }

        // 1. Cek Status Sebelumnya (Mencegah double processing)
        let currentStatus;
        if (methodType === 'QRIS') {
            currentStatus = await getCurrentStatusQris(partner_reff);
        } else if (methodType === 'VA') {
            currentStatus = await getCurrentStatusVa(partner_reff);
        }

        if (currentStatus === 'SUKSES') {
            return res.json({ message: "Transaksi sudah SUKSES sebelumnya. Tidak diproses ulang." });
        }

        // 2. Dapatkan Detail Pesanan
        const orderData = await getOrderDetails(partner_reff);
        if (!orderData) {
            console.error(`❌ Order ${partner_reff} tidak ditemukan.`);
            return res.status(404).json({ error: "Order tidak ditemukan." });
        }

        // 3. Update Status Transaksi
        if (methodType === 'QRIS') {
            await db.execute('UPDATE inquiry_qris SET status = ?, callback_raw = ?, updated_at = NOW() WHERE partner_reff = ?', ['SUKSES', JSON.stringify(req.body), partner_reff]);
        } else if (methodType === 'VA') {
            await db.execute('UPDATE inquiry_va SET status = ?, callback_raw = ?, updated_at = NOW() WHERE partner_reff = ?', ['SUKSES', JSON.stringify(req.body), partner_reff]);
        }

        // 4. Update Status Pesanan Induk
        // Order status diubah dari PENDING_PAYMENT menjadi PAID
        await db.execute(`UPDATE order_service SET order_status = 'PAID', email_status = 'PAID', updated_at = NOW() WHERE order_reff = ?`, [partner_reff]);

        // 5. KIRIM NOTIFIKASI SUKSES (EMAIL & WHATSAPP) - Menggunakan template TangerangFast

        // 5a. KIRIM EMAIL KE PELANGGAN
        const emailContent = createSuccessEmailHTML(orderData);
        await sendEmailNotification(orderData.customer_email, `Konfirmasi Pembayaran Sukses #${orderData.order_reff} - TangerangFast`, emailContent);

        // 5b. KIRIM EMAIL KE ADMIN (BARU)
        const adminEmailContent = createAdminSuccessEmailHTML(orderData);
        await sendEmailNotification('linkutransport@gmail.com', `💸 Pembayaran Masuk Baru: #${orderData.order_reff}`, adminEmailContent);


        // 5c. KIRIM WHATSAPP KE PELANGGAN
        const waVariables = {
            1: orderData.customer_name,
            2: orderData.order_reff,
            3: new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(orderData.total_amount),
            4: "TangerangFast"
        };
        await sendWhatsAppCustomerSuccess(orderData.customer_phone, waVariables);

        // 5d. KIRIM WHATSAPP KE ADMIN (BARU)
        const adminWaMessage = `✅ [PAID] Pesanan Baru! Invoice: *${orderData.order_reff}* | Pelanggan: ${orderData.customer_name} (${orderData.customer_phone}) | Layanan: ${orderData.service_name} | Total: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(orderData.total_amount)} | Metode: ${orderData.payment_method}. 
        --- 
        Mohon segera proses penugasan mitra!`;
        await sendWhatsAppAdminNotification(ADMIN_PHONE, adminWaMessage);


        // 6. LOGIKA BISNIS SELANJUTNYA: PANGGIL FUNGSI PENUGASAN MITRA (DILUAR CALLBACK INI)

        res.json({ message: "Callback diterima dan transaksi diproses" });

    } catch (err) {
        const logMsg = `❌ Gagal memproses callback: ${err.message}`;
        console.error(logMsg);
        logToFile(logMsg);
        res.status(500).json({ error: "Gagal memproses callback", detail: err.message });
    }
});

// 4. ENDPOINT DOWNLOAD QR (DIPERTAHANKAN)
app.get('/download-qr/:partner_reff', async (req, res) => {
    const partner_reff = req.params.partner_reff;

    try {
        // 1️⃣ Cek apakah QR sudah ada di DB
        const [check] = await db.query(
            'SELECT qris_image FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (check.length > 0 && check[0].qris_image) {
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(check[0].qris_image);
        }

        // 2️⃣ Ambil URL QR dari DB
        const [rows] = await db.query(
            'SELECT qris_url FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (!rows.length || !rows[0].qris_url) {
            return res.status(404).send('QRIS tidak ditemukan.');
        }

        const imageUrl = rows[0].qris_url.trim();

        // 3️⃣ Download gambar sebagai buffer
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // 4️⃣ Simpan ke DB
        await db.query(
            'UPDATE inquiry_qris SET qris_image = ? WHERE partner_reff = ?',
            [buffer, partner_reff]
        );

        // 5️⃣ Kirim ke user dengan force download
        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        res.status(500).send('Terjadi kesalahan server.');
    }
});


// 5. ENDPOINT VA LIST
app.get('/va-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Logika penghapusan data PENDING kadaluarsa
        // Menggunakan 1440 menit (1 hari) sebagai batas waktu kedaluwarsa
        const oneDayInMs = 1440 * 60 * 1000;

        const [pendingBefore] = await db.query(`
            SELECT id, created_at
            FROM inquiry_va
            WHERE status = 'PENDING'
        `);

        const now = Date.now();
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > oneDayInMs)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_va WHERE id IN (?)`, [idsToDelete]);
        }

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT bank_name, va_number, amount, status, partner_reff, expired, created_at
            FROM inquiry_va
            WHERE customer_id = ? OR partner_reff IN (
                SELECT order_reff FROM order_service WHERE customer_name = ?
            )
            ORDER BY created_at DESC
            LIMIT 5
        `, [username, username]);

        res.json(results);
    } catch (err) {
        console.error("DB error (va-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data VA" });
    }
});

// 6. ENDPOINT QR LIST
app.get('/qr-list', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username diperlukan" });
    }

    try {
        // Logika penghapusan data PENDING kadaluarsa
        // Menggunakan 1440 menit (1 hari) sebagai batas waktu kedaluwarsa
        const oneDayInMs = 1440 * 60 * 1000;

        const [pendingBefore] = await db.query(`
            SELECT id, created_at
            FROM inquiry_qris
            WHERE status = 'PENDING'
        `);

        const now = Date.now();
        const idsToDelete = pendingBefore
            .filter(row => now - new Date(row.created_at).getTime() > oneDayInMs)
            .map(row => row.id);

        if (idsToDelete.length > 0) {
            await db.query(`DELETE FROM inquiry_qris WHERE id IN (?)`, [idsToDelete]);
        }

        // Ambil data terbaru
        const [results] = await db.query(`
            SELECT partner_reff, amount, status, qris_url, expired, created_at
            FROM inquiry_qris
            WHERE customer_id = ? OR partner_reff IN (
                SELECT order_reff FROM order_service WHERE customer_name = ?
            )
            ORDER BY created_at DESC
            LIMIT 5
        `, [username, username]);

        res.json(results);
    } catch (err) {
        console.error("DB error (qr-list):", err.message);
        res.status(500).json({ error: "Terjadi kesalahan saat mengambil data QR" });
    }
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`💡 Nama Brand: TANGERANGFAST`);
    console.log(`🚨 Pastikan Anda mengganti 'YOUR_EMAIL_APP_PASSWORD' dengan App Password yang valid.`);
});