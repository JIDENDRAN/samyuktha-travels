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
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const socketIO = require("socket.io");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ================= LOG CAPTURE SYSTEM =================
const logHistory = [];
const originalLog = console.log;

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
      <body style="background:#1a1a1a; color:#0f0; font-family:monospace; padding:20px;">
        <h2>🚀 WhatsApp Bot Logs (Stable Mode)</h2>
        <div style="background:#000; padding:15px; border-radius:8px; border:1px solid #333; max-height:80vh; overflow-y:auto;">
          ${logHistory.reverse().map(log => `<div style="margin-bottom:5px; border-bottom:1px solid #222; padding-bottom:5px;">${log}</div>`).join("")}
        </div>
        <script>setTimeout(() => window.location.reload(), 5000);</script>
      </body>
    </html>
  `);
});

app.get("/scan", (req, res) => {
  res.send("<h3>Bot is starting... Please check /logs for the QR code.</h3>");
});

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

let sock;
let lastQrCode = "";

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("baileys_auth");
  const { version } = await fetchLatestBaileysVersion();

  console.log(`[3] --- WHATSAPP ENGINE STARTING (v${version.join(".")}) ---`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false, // Handle QR ourselves to avoid deprecation warning
    logger: pino({ level: "silent" }),
    browser: ["Windows", "Chrome", "11.0.0"]
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQrCode = qr;
      console.log("\n⚠️ [QR ACTION] SCAN THE QR CODE BELOW!");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`❌ Connection closed (Status: ${statusCode}). Reconnecting in 5s...`, shouldReconnect);

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 5000);
      }
    } else if (connection === "open") {
      console.log("✅ [READY] WHATSAPP IS ONLINE! 🚀");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// ================= SEND WHATSAPP API =================
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  console.log(`📨 [NEW REQUEST] Sending to: ${phone}`);

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
    console.error(`❌ [FAILED] Delivery Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[1] --- ULTRALIGHT BOT LIVE ---`);
  console.log(`[2] --- PORT: ${PORT} ---`);
  connectToWhatsApp().catch(err => console.error("Initialization Error:", err));
});
