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
          
          <div style="background:#222; padding:20px; border-radius:8px; margin-bottom:20px; border:1px solid #333;">
            <h3 style="color:#0f0; margin-top:0;">✅ BOT STATUS: ${sock ? "ONLINE" : "INITIALIZING..."}</h3>
            
            <div style="margin-top:15px; background:#111; padding:15px; border-radius:8px; border:1px solid #444;">
               <h4 style="margin:0 0 10px 0; color:#fff;">🧪 SEND TEST MESSAGE</h4>
               <input id="phone" placeholder="91XXXXXXXXXX" style="padding:10px; border-radius:4px; border:1px solid #555; background:#000; color:#fff; width:150px;" />
               <input id="msg" placeholder="Test Hello" style="padding:10px; border-radius:4px; border:1px solid #555; background:#000; color:#fff; width:200px;" />
               <button onclick="sendTest()" style="padding:10px 20px; background:#0f0; color:#000; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">SEND</button>
               <p id="status" style="margin:10px 0 0 0; font-size:12px; color:#aaa;"></p>
            </div>
          </div>

          ${lastQrDataUrl ? `
            <div style="background:#fff; padding:20px; border-radius:12px; display:inline-block; margin-bottom:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
              <h3 style="color:#333; margin-top:0;">⚠️ SCAN TO LOGIN</h3>
              <img src="${lastQrDataUrl}" style="width:250px; height:250px; border:1px solid #ddd; display:block; margin:0 auto;" />
            </div>
          ` : ""}

          <div style="background:#000; padding:15px; border-radius:8px; border:1px solid #333; max-height:40vh; overflow-y:auto; font-family:monospace; color:#0f0; font-size:13px;" id="logContainer">
            ${logHistory.reverse().map(log => `<div style="margin-bottom:5px; border-bottom:1px solid #222; padding-bottom:5px; opacity:0.9;">${log}</div>`).join("")}
          </div>
        </div>
        <script>
          async function sendTest() {
            const phone = document.getElementById('phone').value;
            const message = document.getElementById('msg').value;
            const status = document.getElementById('status');
            status.innerText = "Sending...";
            try {
              const res = await fetch('/api/send-whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message })
              });
              const data = await res.json();
              status.innerText = data.success ? "✅ Sent Successfully!" : "❌ Error: " + data.error;
            } catch (e) {
              status.innerText = "❌ Connection Failed";
            }
          }
          // Only auto-reload if not logged in (to see QR)
          ${lastQrDataUrl ? "setTimeout(() => window.location.reload(), 10000);" : ""}
        </script>
      </body>
    </html>
  `);
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
      console.log("✅ [READY] WHATSAPP IS ONLINE!");
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// ================= SEND WHATSAPP API =================
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  console.log(`📨 [API REQUEST] To: ${phone}`);

  if (!sock) return res.status(503).json({ success: false, error: "WhatsApp not initialized" });

  let cleanPhone = phone.toString().replace(/\D/g, "");
  if (!cleanPhone.startsWith("91") && cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
  const chatId = `${cleanPhone}@s.whatsapp.net`;

  try {
    await sock.sendMessage(chatId, { text: message });
    console.log(`✅ [SUCCESS] Sent to ${chatId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ [FAILED] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[1] --- DASHBOARD LIVE ON PORT ${PORT} ---`);
  connectToWhatsApp().catch(err => console.error("Initialization Error:", err));
});
