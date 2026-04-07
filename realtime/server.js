const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
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
               <div style="display:flex; gap:10px; margin-bottom:10px;">
                  <input id="phone" placeholder="Phone (10 digits)" style="padding:10px; border-radius:4px; border:1px solid #555; background:#000; color:#fff; flex:1;" />
                  <input id="msg" placeholder="Your message here..." style="padding:10px; border-radius:4px; border:1px solid #555; background:#000; color:#fff; flex:2;" />
                  <button onclick="sendTest()" style="padding:10px 20px; background:#0f0; color:#000; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">SEND</button>
               </div>
               <p id="status" style="margin:0; font-size:12px; color:#aaa;"></p>
            </div>
          </div>

          ${lastQrDataUrl ? `
            <div style="background:#fff; padding:20px; border-radius:12px; display:inline-block; margin-bottom:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5);">
              <h3 style="color:#333; margin-top:0;">⚠️ QR CODE READY</h3>
              <p style="color:#666; margin-bottom:15px;">Scan this image with your phone to login:</p>
              <img src="${lastQrDataUrl}" style="width:250px; height:250px; border:1px solid #ddd; display:block; margin:0 auto;" />
            </div>
          ` : `
            <div style="padding:10px; background:rgba(0,255,0,0.1); border:1px solid #0f0; border-radius:4px; margin-bottom:20px; color:#0f0; font-size:14px;">
                ✔ Device is linked and ready to send messages.
            </div>
          `}

          <div style="background:#000; padding:15px; border-radius:8px; border:1px solid #333; max-height:40vh; overflow-y:auto; font-family:monospace; color:#0f0; font-size:13px;" id="logContainer">
            <div style="color:#888; margin-bottom:10px; border-bottom:1px solid #444; padding-bottom:5px;">RECENT ACTIVITY LOGS:</div>
            ${logHistory.reverse().map(log => `<div style="margin-bottom:5px; border-bottom:1px solid #222; padding-bottom:5px; opacity:0.9;">${log}</div>`).join("")}
          </div>
        </div>
        <script>
          async function sendTest() {
            const phone = document.getElementById('phone').value;
            const message = document.getElementById('msg').value;
            const status = document.getElementById('status');
            if(!phone || !message) { alert("Please enter phone and message"); return; }
            
            status.innerText = "⏳ Sending command to server...";
            try {
              const res = await fetch('/api/send-whatsapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, message })
              });
              const data = await res.json();
              if(data.success) {
                status.style.color = "#0f0";
                status.innerText = "✅ MESSAGE SENT SUCCESSFULLY!";
              } else {
                status.style.color = "#f00";
                status.innerText = "❌ FAILED: " + (data.error || "Unknown Error");
              }
            } catch (e) {
              status.style.color = "#f00";
              status.innerText = "❌ CONNECTION ERROR: Dashboard cannot reach the API.";
            }
          }
          // Reload if QR is visible to stay fresh
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

      console.log(`❌ Connection closed (Status: ${statusCode}). Reconnecting...`, shouldReconnect);
      if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 3000);
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
  console.log(`📨 [API] Request to send to: ${phone}`);

  if (!sock) return res.status(503).json({ success: false, error: "Bot is starting, try again in 5s." });

  // 1. Clean the phone number
  let cleanPhone = phone.toString().replace(/\D/g, ""); // Remove everything except numbers

  // 2. Handle Indian numbers (ensure 91 prefix)
  if (cleanPhone.length === 10) {
    cleanPhone = "91" + cleanPhone;
  } else if (cleanPhone.length === 12 && cleanPhone.startsWith("91")) {
    // Already has 91
  } else if (!cleanPhone.startsWith("91")) {
    // Some other format? Let's assume user wants 91 if it's 10 digits inside
    if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);
    cleanPhone = "91" + cleanPhone;
  }

  const chatId = `${cleanPhone}@s.whatsapp.net`;

  try {
    // Wait for the socket to be stable
    await sock.waitForConnectionUpdate((v) => v.connection === 'open', 2000).catch(() => { });

    await sock.sendMessage(chatId, { text: message });
    console.log(`✅ [SENT] Message delivered to ${chatId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ [ERROR] Could not send to ${chatId}: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[1] --- BOT ACTIVE ON PORT ${PORT} ---`);
  connectToWhatsApp().catch(err => console.error("Critical Start Error:", err));
});
