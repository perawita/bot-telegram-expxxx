require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Telegraf, session } = require("telegraf");
const LocalSession = require("telegraf-session-local");
const qs = require("qs");

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const API_URL = process.env.API_BACKEND || "http://localhost/website/expired/api";

function escapeMarkdownV2(text) {
    return text.replace(/[_*[\]()~`>#\+=|{}.!-]/g, "\\$&");
}


// Middleware session dengan TTL (time-to-live) lebih lama
const localSession = new LocalSession({
    database: "session.json",
    property: "session",
    storage: LocalSession.storageFileAsync,
    format: {
        serialize: (obj) => JSON.stringify(obj, null, 2),
        deserialize: (str) => JSON.parse(str),
    },
    state: { user: null },
    ttl: 7 * 24 * 60 * 60 // Durasi session: 7 hari
});

bot.use(localSession.middleware());

// Debugging session
bot.use((ctx, next) => {
    console.log("DEBUG SESSION:", ctx.session);
    return next();
});

// Perintah /start
bot.start((ctx) => {
    ctx.reply(escapeMarkdownV2(
        `Halo, ${ctx.from.first_name}! Selamat datang di EXPIRED.\n\n` +
        "📌 Dokumentasi Perintah:\n" +
        "🎁 /login - Untuk login akun panel\n" +
        "🎁 /show_profile - Informasi akun panel\n" +
        "🎁 /show_balance - Informasi saldo akun panel\n" +
        "🎁 /show_product - List kuota"),
        { parse_mode: "MarkdownV2" }
    );
});

// Perintah /login
bot.command("login", (ctx) => {
    ctx.reply(escapeMarkdownV2("Silakan kirim email Anda untuk login."));
    ctx.session.step = "email";
});

// Perintah /show_profile
bot.command("show_profile", (ctx) => {
    if (ctx.session.user) {
        const user = ctx.session.user;
        ctx.reply(escapeMarkdownV2(
            `👤 *Profil Anda:*\n` +
            `🆔 *ID:* ${user.id}\n` +
            `📧 *Email:* ${user.email}\n` +
            `👤 *Nama:* ${user.name}`),
            { parse_mode: "MarkdownV2" }
        );
    } else {
        ctx.reply(escapeMarkdownV2("⚠️ Anda belum login! Gunakan `/login` untuk masuk."));
    }
});

// Perintah /show_balance
bot.command("show_balance", (ctx) => {
    if (ctx.session.user) {
        ctx.reply(escapeMarkdownV2(`💰 *Saldo Anda:* ${ctx.session.user.saldo} 💳`), { parse_mode: "MarkdownV2" });
    } else {
        ctx.reply(escapeMarkdownV2("⚠️ Anda belum login! Gunakan `/login` untuk masuk."));
    }
});

// Perintah /show_product
bot.command("show_product", async (ctx) => {
    if (!ctx.session.user) {
        return ctx.reply(escapeMarkdownV2("⚠️ Anda belum login! Gunakan `/login` untuk masuk."));
    }

    try {
        const response = await axios.post(`${API_URL}/view.php`);
        if (response.data.status === "true" && response.data.data.length > 0) {
            let message = `💰 *Saldo Anda:* ${ctx.session.user.saldo} 💳\n\n📦 Daftar Kuota Tersedia:\n\n`;
            const uniqueProducts = new Set();
            
            response.data.data.forEach((product, index) => {
                const key = `${product.nama_paket}-${product.quota_allocated}`;
            
                if (!uniqueProducts.has(key)) {
                    uniqueProducts.add(key);
                    response.data.data.forEach((product, index) => {
                        message += `🔹 ${index + 1}. *${product.nama_paket}*\n` +
                            `💰 Harga: ${product.harga} 💳\n` +
                            `📦 Size Quota: ${product.quota_allocated} 💳\n` +
                            `🆔 ID Product: ${product.id}\n` +
                            `➖➖➖➖➖➖➖➖➖➖\n`;
                    });
                }
            });

            message += "\n🛒 *Cara Membeli Produk:*\n" +
                "1️⃣ Ketik perintah berikut:\n" +
                "`/buy <id_produk> <nomor_pelanggan>`\n\n" +
                "📌 Contoh: `/buy 123456 081234567890`\n" +
                "⚠️ Pastikan saldo mencukupi sebelum melakukan pembelian.";

            ctx.reply(escapeMarkdownV2(message), { parse_mode: "MarkdownV2" });
        } else {
            ctx.reply("⚠️ Tidak ada kuota tersedia saat ini.");
        }
    } catch (error) {
        console.error("DEBUG ERROR:", error.message);
        ctx.reply("⚠️ Terjadi kesalahan saat mengambil data kuota.");
    }
});

// Perintah /buy
bot.command("buy", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
        return ctx.reply("❌ Format salah! Gunakan: `/buy <id_produk> <nomor_pelanggan>`");
    }

    const id_produk = args[0];
    const customer_no = args[1];

    try {
        const response = await axios.post(`${API_URL}/buy.php`, {
            id: id_produk,
            "customer-no": customer_no,
            user_id: ctx.session.user.id
        });

        if (response.data.status === "success") {
            ctx.reply(`✅ Pembelian berhasil!\n💰 Saldo terbaru: ${response.data.saldo_terbaru}`);
        } else {
            ctx.reply(`❌ Gagal membeli produk: ${response.data.message}`);
        }
    } catch (error) {
        console.error("DEBUG ERROR:", error.message);
        ctx.reply("⚠️ Terjadi kesalahan saat memproses pembelian.");
    }
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

            const response = await axios.post(`${API_URL}/login.php`, payload);

            if (response.data.status === "true" && response.data.data) {
                ctx.session.user = response.data.data;
                ctx.reply(`✅ Login berhasil! Selamat datang, ${response.data.data.name}!`);
            } else {
                ctx.reply("❌ Login gagal! Email atau password salah.");
            }
        } catch (error) {
            console.error("DEBUG ERROR:", error.message);
            ctx.reply("⚠️ Terjadi kesalahan saat login. Silakan coba lagi nanti.");
        }
    }
});

// Jalankan bot
bot.launch().then(() => console.log("Bot Telegram berjalan..."));

// Server Express
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('Hello, World!'));

app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
