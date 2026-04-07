const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const express = require("express");
const http = require("http");
const bodyParser = require("body-parser");
const cors = require("cors");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const pino = require("pino");
const socketIO = require("socket.io");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= LOG & QR CAPTURE SYSTEM =================
const logHistory = [];
const originalLog = console.log;
let lastQrDataUrl = "";

function captureLog(type, args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(" ");
  const timestamp = new Date().toLocaleTimeString();
  logHistory.push(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
  if (logHistory.length > 50) logHistory.shift();
}

console.log = (...args) => { originalLog(...args); captureLog("info", args); };
console.error = (...args) => { originalLog("❌", ...args); captureLog("error", args); };

app.get("/logs", (req, res) => {
  res.send(`
    <html>
      <body style="background:#1a1a1a; color:#eee; font-family:sans-serif; padding:20px; line-height:1.6;">
        <div style="max-width:800px; margin:0 auto;">
          <h2 style="color:#0f0;">🚀 WhatsApp Bot Dashboard</h2>
          
          ${lastQrDataUrl ? `
            <div style="background:#fff; padding:20px; border-radius:12px; display:inline-block; margin-bottom:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
              <h3 style="color:#333; margin-top:0;">⚠️ QR CODE READY</h3>
              <p style="color:#666; margin-bottom:15px;">Scan this image with your phone to login:</p>
              <img src="${lastQrDataUrl}" style="width:250px; height:250px; border:1px solid #ddd; display:block; margin:0 auto;" />
            </div>
          ` : `
            <div style="background:#222; padding:20px; border-radius:8px; margin-bottom:20px; border:1px solid #333;">
              <h3 style="color:#0f0; margin-top:0;">✅ BOT STATUS: ${sock ? "INITIALIZED" : "STARTING..."}</h3>
              <p>Wait for the QR code to appear here. If you are already logged in, you won't see a QR.</p>
            </div>
          `}

          <div style="background:#000; padding:15px; border-radius:8px; border:1px solid #333; max-height:60vh; overflow-y:auto; font-family:monospace; color:#0f0; font-size:13px;">
            ${logHistory.reverse().map(log => `<div style="margin-bottom:5px; border-bottom:1px solid #222; padding-bottom:5px; opacity:0.9;">${log}</div>`).join("")}
          </div>
        </div>
        <script>setTimeout(() => window.location.reload(), 5000);</script>
      </body>
    </html>
  `);
});

app.get("/scan", (req, res) => {
  res.redirect("/logs");
});

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

let sock;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth");
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[3] --- WHATSAPP ENGINE STARTING (v${version.join(".")}) ---`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["Windows", "Chrome", "11.0.0"]
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("⚠️ New QR code generated. Updating dashboard...");
      lastQrDataUrl = await QRCode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      lastQrDataUrl = "";

      console.log(`❌ Connection closed (Status: ${statusCode}). Reconnecting in 5s...`, shouldReconnect);
      if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 5000);
    } else if (connection === "open") {
      lastQrDataUrl = "";
      console.log("✅ [READY] WHATSAPP IS ONLINE! (Dashboard Updated)");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// ================= SEND WHATSAPP API =================
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  console.log(`📨 [NEW REQUEST] Outgoing to: ${phone}`);

  if (!sock) return res.status(503).json({ success: false, error: "WhatsApp not initialized" });

  let cleanPhone = phone.toString().replace(/\D/g, "");
  if (!cleanPhone.startsWith("91")) cleanPhone = "91" + cleanPhone;
  const chatId = `${cleanPhone}@s.whatsapp.net`;

  try {
    const presence = await sock.onWhatsApp(chatId);
    if (!presence || presence.length === 0) {
      console.warn(`⚠️ [SKIP] Number ${cleanPhone} is not on WhatsApp.`);
    }

    await sock.sendMessage(chatId, { text: message });
    console.log(`✅ [SUCCESS] Delivered to ${chatId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ [FAILED] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[1] --- ULTRALIGHT BOT DASHBOARD ---`);
  console.log(`[2] --- VISIT /logs FOR QR CODE ---`);
  connectToWhatsApp().catch(err => console.error("Initialization Error:", err));
});
