require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Telegraf, session } = require("telegraf");
const qs = require("qs");

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.use(session());

// Middleware sesi
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    console.log("DEBUG SESSION:", ctx.session);
    return next();
});

const API_URL = process.env.API_BACKEND || "http://localhost/website/expired/api";

/**
 * _____________________
 * Fungsi Utility
 * ____________________
 */

// Escape karakter spesial di MarkdownV2
const escapeMarkdown = (text) => {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

// Convert ke format uang yang mudah di baca
function formatUang(value) {
    if (value >= 1_000_000_000) {
        return (value / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
    } else if (value >= 1_000_000) {
        return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'j';
    } else if (value >= 1_000) {
        return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    } else {
        return value.toString();
    }
}

/**
 * _____________________
 * End fungsi Utility
 * ____________________
 */

// Perintah /start
bot.start((ctx) => {
    ctx.reply(
        escapeMarkdown(`Halo, ${ctx.from.first_name}! Selamat datang di EXPIRED.\n`) +
        escapeMarkdown("📌 Dokumentasi Perintah:\n") +
        escapeMarkdown("🎁 /login - Untuk login akun panel\n") +
        escapeMarkdown("🎁 /show_profile - Informasi akun panel\n") +
        escapeMarkdown("🎁 /show_balance - Informasi saldo akun panel\n") +
        escapeMarkdown("🎁 /show_product - List kuota"),
        { parse_mode: "MarkdownV2" }
    );
});

// Perintah /login
bot.command("login", (ctx) => {
    ctx.reply("Silakan kirim email Anda untuk login.");
    ctx.session.step = "email";
});

// Perintah /show_profile
bot.command("show_profile", (ctx) => {
    console.log("DEBUG SESSION USER:", ctx.session.user);
    if (ctx.session.user) {
        const user = ctx.session.user;

        ctx.reply(
            `👤 *Profil Anda:*\n` +
            `🆔 *ID:* ${escapeMarkdown(user.id.toString())}\n` +
            `📧 *Email:* ${escapeMarkdown(user.email)}\n` +
            `👤 *Nama:* ${escapeMarkdown(user.name)}`,
            { parse_mode: "MarkdownV2" }
        );
    } else {
        ctx.reply("⚠️ Anda belum login! Gunakan `/login` untuk masuk.");
    }
});


// Perintah /show_balance
bot.command("show_balance", (ctx) => {
    if (ctx.session.user) {
        ctx.reply(`💰 *Saldo Anda:* ${formatUang(ctx.session.user.saldo)} 💳`, { parse_mode: "MarkdownV2" });
    } else {
        ctx.reply("⚠️ Anda belum login! Gunakan `/login` untuk masuk.");
    }
});

// Perintah /show_product untuk menampilkan daftar kuota dan instruksi pembelian
bot.command("show_product", async (ctx) => {
    
    if (!ctx.session.user) {
        ctx.reply("⚠️ Anda belum login! Gunakan `/login` untuk masuk.");
        return;
    }

    try {
        const response = await axios.post(`${API_URL}/view.php`);
        if (response.data.status === "true" && response.data.data.length > 0) {
            let message = escapeMarkdown(`💰 *Saldo Anda:* ${formatUang(ctx.session.user.saldo)} 💳\n`);
            message += escapeMarkdown("📦 Daftar Kuota Tersedia:\n\n");
            const uniqueProducts = new Set();
            
            response.data.data.forEach((product, index) => {
                const key = `${product.nama_paket}-${product.quota_allocated}`;
            
                if (!uniqueProducts.has(key)) {
                    uniqueProducts.add(key);
            
                    message += escapeMarkdown(`🔹 *${(index + 1).toString()}\\.${(product.nama_paket)}*\n`);
                    message += escapeMarkdown(`💰 Harga: ${formatUang(product.harga).toString().replace(/\./g, "\\.")} 💳\n`);
                    message += escapeMarkdown(`📦 Size Quota: ${product.quota_allocated} 💳\n`);
                    message += escapeMarkdown(`🆔 ID Product: ${product.id.toString().replace(/\./g, "\\.")}\n`);
                    message += escapeMarkdown(`➖➖➖➖➖➖➖➖➖➖\n`);
                }
            });
            

            // Tambahkan instruksi pembelian
            message += escapeMarkdown(
                "\n🛒 *Cara Membeli Produk:*\n" +
                "1️⃣ Ketik perintah berikut:\n" +
                "`/buy <id_produk> <nomor_pelanggan>`\n\n" +
                "📌 Contoh: `/buy 123456 081234567890`\n" +
                "⚠️ Pastikan saldo mencukupi sebelum melakukan pembelian."
            );

            ctx.reply(message, { parse_mode: "MarkdownV2" });
        } else {
            ctx.reply(escapeMarkdown("⚠️ Tidak ada kuota tersedia saat ini."), { parse_mode: "MarkdownV2" });
        }
    } catch (error) {
        console.error("DEBUG ERROR:", error.response ? error.response.data : error.message);
        ctx.reply(escapeMarkdown("⚠️ Terjadi kesalahan saat mengambil data kuota."), { parse_mode: "MarkdownV2" });
    }
});

// Perintah /buy untuk melakukan pembelian
bot.command("buy", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
        return ctx.reply(escapeMarkdown("❌ Format salah! Gunakan: `/buy <id_produk> <nomor_pelanggan>`"), { parse_mode: "MarkdownV2" });
    }

    const id_produk = args[0];
    const customer_no = args[1];

    try {
        const response = await axios.post(`${API_URL}/buy.php`, {
            id: id_produk, "customer-no": customer_no, user_id: ctx.session.user.id 
        }, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        if (response.data.status === "success") {
            ctx.reply(escapeMarkdown(`✅ Pembelian berhasil!\n💰 Saldo terbaru: ${formatUang(response.data.saldo_terbaru)}`), { parse_mode: "MarkdownV2" });
        } else {
            ctx.reply(escapeMarkdown(`❌ Gagal membeli produk: ${response.data.message}`), { parse_mode: "MarkdownV2" });
        }
        console.log(`DEBUG BUY: ${response.data}`);
    } catch (error) {
        console.error("DEBUG ERROR:", error.response ? error.response.data : error.message);
        ctx.reply(escapeMarkdown("⚠️ Terjadi kesalahan saat memproses pembelian."), { parse_mode: "MarkdownV2" });
    }
});



// Debug perintah yang masuk
bot.use((ctx, next) => {
    console.log("DEBUG COMMAND:", ctx.update.message?.text);
    return next();
});


// Menangani input email dan password
bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (ctx.session.step === "email") {
        if (!text.includes("@")) {
            return ctx.reply("⚠️ Email tidak valid! Masukkan email yang benar.");
        }
        ctx.session.email = text;
        ctx.session.step = "password";
        ctx.reply("Sekarang kirimkan password Anda.");
    } else if (ctx.session.step === "password") {
        ctx.session.password = text;
        ctx.session.step = null;

        try {
            const payload = qs.stringify({
                email: ctx.session.email,
                password: ctx.session.password
            });

            console.log("DEBUG REQUEST:", payload);

            const response = await axios.post(`${API_URL}/login.php`, payload, {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            });

            console.log('DEBUG LOGIN:', response.data);

            if (response.data.status === "true" && response.data.data) {
                ctx.session.user = response.data.data;
                ctx.reply(`✅ Login berhasil! Selamat datang, ${response.data.data.name}!`);
            } else {
                ctx.reply("❌ Login gagal! Email atau password salah.");
            }
        } catch (error) {
            console.error("DEBUG ERROR:", error.response ? error.response.data : error.message);
            ctx.reply("⚠️ Terjadi kesalahan saat login. Silakan coba lagi nanti.");
        }
    }
});

// Jalankan bot
bot.launch().then(() => console.log("Bot Telegram berjalan..."));

// Server Express
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('Hello, World!'));

app.use((req, res) => res.status(404).send('404 - Page Not Found'));

app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));

// Menangani error bot
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
