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
const path = require("path");
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
  const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  logHistory.push(logEntry);
  if (logHistory.length > 50) logHistory.shift();
  if (io) io.emit("log", logEntry);
}

console.log = (...args) => { originalLog(...args); captureLog("info", args); };
console.error = (...args) => { originalLog("❌", ...args); captureLog("error", args); };

app.get("/logs", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot Dashboard | Premium</title>
        <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #050505;
                --card-bg: rgba(20, 20, 20, 0.7);
                --primary: #00ff88;
                --primary-glow: rgba(0, 255, 136, 0.3);
                --error: #ff4757;
                --text: #e0e0e0;
                --text-dim: #888;
                --border: rgba(255, 255, 255, 0.1);
            }

            * { box-sizing: border-box; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            
            body {
                background: var(--bg);
                color: var(--text);
                font-family: 'Plus Jakarta Sans', sans-serif;
                margin: 0;
                padding: 0;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                overflow-x: hidden;
            }

            /* Animated Background Blobs */
            .blob {
                position: fixed;
                width: 500px;
                height: 500px;
                background: radial-gradient(circle, var(--primary-glow) 0%, transparent 70%);
                filter: blur(80px);
                z-index: -1;
                opacity: 0.5;
                pointer-events: none;
            }
            .blob-1 { top: -250px; left: -250px; }
            .blob-2 { bottom: -250px; right: -250px; }

            .container {
                width: 100%;
                max-width: 900px;
                padding: 40px 20px;
                animation: fadeIn 0.8s ease-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }

            header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 30px;
            }

            h1 {
                font-size: 24px;
                margin: 0;
                font-weight: 700;
                letter-spacing: -0.5px;
                background: linear-gradient(135deg, #fff 0%, #aaa 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .status-badge {
                padding: 8px 16px;
                border-radius: 100px;
                font-size: 12px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
                background: var(--card-bg);
                border: 1px solid var(--border);
                backdrop-filter: blur(10px);
            }

            .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #aaa;
                box-shadow: 0 0 10px rgba(170, 170, 170, 0.5);
            }

            .status-online .status-dot {
                background: var(--primary);
                box-shadow: 0 0 15px var(--primary);
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.2); }
                100% { opacity: 1; transform: scale(1); }
            }

            .card {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 20px;
                padding: 30px;
                backdrop-filter: blur(20px);
                margin-bottom: 24px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.4);
            }

            .card-title {
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: var(--text-dim);
                margin-bottom: 20px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .input-group {
                display: grid;
                grid-template-columns: 1fr 2fr auto;
                gap: 12px;
            }

            input {
                background: rgba(255,255,255,0.05);
                border: 1px solid var(--border);
                padding: 14px 20px;
                border-radius: 12px;
                color: #fff;
                font-family: inherit;
                font-size: 15px;
            }

            input:focus {
                outline: none;
                border-color: var(--primary);
                background: rgba(0, 255, 136, 0.05);
            }

            button {
                background: var(--primary);
                color: #000;
                border: none;
                padding: 0 24px;
                height: 50px;
                border-radius: 12px;
                font-weight: 700;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px var(--primary-glow);
            }

            button:active { transform: translateY(0); }

            button:disabled { opacity: 0.5; cursor: not-allowed; }

            .qr-container {
                text-align: center;
                padding: 40px;
                display: none;
            }

            .qr-image {
                background: #fff;
                padding: 15px;
                border-radius: 16px;
                display: inline-block;
                margin-bottom: 20px;
                box-shadow: 0 0 40px rgba(255,255,255,0.1);
            }

            .qr-image img {
                display: block;
                width: 240px;
                height: 240px;
            }

            .logs-container {
                height: 350px;
                overflow-y: auto;
                font-family: 'JetBrains Mono', monospace;
                font-size: 13px;
                padding: 10px;
                background: rgba(0,0,0,0.3);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.05);
            }

            .log-entry {
                padding: 8px 12px;
                border-bottom: 1px solid rgba(255,255,255,0.03);
                white-space: pre-wrap;
                word-break: break-all;
            }

            .log-timestamp { color: var(--text-dim); margin-right: 10px; }
            .log-info { color: var(--primary); }
            .log-error { color: var(--error); }

            /* Custom Scrollbar */
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

            #msg-status {
                margin-top: 15px;
                font-size: 13px;
                font-weight: 500;
            }

            @media (max-width: 600px) {
                .input-group { grid-template-columns: 1fr; }
                button { width: 100%; }
            }
        </style>
    </head>
    <body>
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>

        <div class="container">
            <header>
                <h1>🚀 Samyuktha WhatsApp</h1>
                <div id="status-badge" class="status-badge">
                    <div class="status-dot"></div>
                    <span id="status-text">INITIALIZING...</span>
                </div>
            </header>

            <!-- QR SECTION -->
            <div id="qr-card" class="card qr-container">
                <div class="card-title">⚠️ LOGIN REQUIRED</div>
                <div class="qr-image">
                    <img id="qr-img" src="" alt="Scan this QR">
                </div>
                <p style="color: var(--text-dim)">Scan this QR code with your Linked Devices in WhatsApp.</p>
            </div>

            <!-- MESSAGING SECTION -->
            <div class="card">
                <div class="card-title">🧪 SEND TEST MESSAGE</div>
                <div class="input-group">
                    <input type="text" id="phone" placeholder="Phone (10 digits)" maxlength="10">
                    <input type="text" id="msg" placeholder="Your message here...">
                    <button id="send-btn" onclick="sendTest()">
                        <span>SEND</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </div>
                <div id="msg-status"></div>
            </div>

            <!-- LOGS SECTION -->
            <div class="card">
                <div class="card-title">📋 ACTIVITY LOGS</div>
                <div id="logs" class="logs-container"></div>
            </div>
        </div>

        <script>
            const socket = io();
            const statusBadge = document.getElementById('status-badge');
            const statusText = document.getElementById('status-text');
            const qrCard = document.getElementById('qr-card');
            const qrImg = document.getElementById('qr-img');
            const logsContainer = document.getElementById('logs');
            const sendBtn = document.getElementById('send-btn');
            const msgStatus = document.getElementById('msg-status');

            socket.on('status', (status) => {
                statusText.innerText = status;
                if(status === 'ONLINE') {
                    statusBadge.classList.add('status-online');
                    qrCard.style.display = 'none';
                } else {
                    statusBadge.classList.remove('status-online');
                }
            });

            socket.on('qr', (dataUrl) => {
                if(dataUrl) {
                    qrImg.src = dataUrl;
                    qrCard.style.display = 'block';
                } else {
                    qrCard.style.display = 'none';
                }
            });

            socket.on('log', (log) => {
                addLog(log);
            });

            socket.on('logs', (history) => {
                logsContainer.innerHTML = '';
                history.forEach(addLog);
            });

            function addLog(log) {
                const div = document.createElement('div');
                div.className = 'log-entry';
                
                // Style log parts
                const styledLog = log.replace(/\\[(.*?)\\]/, '<span class="log-timestamp">[$1]</span>')
                                    .replace(/INFO:/, '<span class="log-info">INFO:</span>')
                                    .replace(/ERROR:/, '<span class="log-error">ERROR:</span>');
                
                div.innerHTML = styledLog;
                logsContainer.appendChild(div);
                logsContainer.scrollTop = logsContainer.scrollHeight;
            }

            async function sendTest() {
                const phone = document.getElementById('phone').value;
                const message = document.getElementById('msg').value;
                
                if(!phone || !message) return;
                
                sendBtn.disabled = true;
                msgStatus.innerText = "⏳ Processing...";
                msgStatus.style.color = "var(--text-dim)";

                try {
                    const res = await fetch('/api/send-whatsapp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, message })
                    });
                    const data = await res.json();
                    if(data.success) {
                        msgStatus.innerText = "✅ Message sent successfully!";
                        msgStatus.style.color = "var(--primary)";
                    } else {
                        msgStatus.innerText = "❌ Error: " + data.error;
                        msgStatus.style.color = "var(--error)";
                    }
                } catch (e) {
                    msgStatus.innerText = "❌ Network error";
                    msgStatus.style.color = "var(--error)";
                } finally {
                    sendBtn.disabled = false;
                }
            }
        </script>
    </body>
    </html>
  `);
});

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("status", sock ? "ONLINE" : "INITIALIZING...");
  if (lastQrDataUrl) socket.emit("qr", lastQrDataUrl);
  socket.emit("logs", logHistory);
});

let sock;

async function connectToWhatsApp() {
  const authPath = path.join(__dirname, "..", "baileys_auth");
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`📂 [AUTH] Using session folder: ${authPath}`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: "error" }),
    browser: ["Windows", "Chrome", "122.0.6261.129"]
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQrDataUrl = await QRCode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
      io.emit("qr", lastQrDataUrl);
      console.log("⚠️ [QR] New QR code generated. Please scan.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      lastQrDataUrl = "";
      io.emit("qr", "");
      io.emit("status", "DISCONNECTED - RECONNECTING...");

      console.log(`❌ Connection closed (Status: ${statusCode}). Reconnecting...`, shouldReconnect);
      if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 3000);
    } else if (connection === "open") {
      lastQrDataUrl = "";
      io.emit("qr", "");
      io.emit("status", "ONLINE");
      console.log("✅ [READY] WHATSAPP IS ONLINE AND SAVED!");
    }
  });

  sock.ev.on("creds.update", () => {
    console.log("💾 [AUTH] Session credentials updated/saved.");
    saveCreds();
  });
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
    // 1. Check if we are even initialized
    if (!sock || !sock.user) {
      return res.status(401).json({
        success: false,
        error: "Not logged in. Please scan the QR code on the dashboard first."
      });
    }

    // 2. Wait for the socket to be open if it's currently connecting
    await sock.waitForConnectionUpdate((v) => v.connection === 'open', 5000).catch(() => { });

    await sock.sendMessage(chatId, { text: message });
    console.log(`✅ [SENT] Message delivered to ${chatId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error(`❌ [ERROR] Could not send to ${chatId}: ${err.message}`);

    // Check for specific Baileys "not opened" state
    const errorMsg = err.message.includes("reading 'id'")
      ? "Connection unstable. Please wait a moment or refresh the dashboard."
      : err.message;

    return res.status(500).json({ success: false, error: errorMsg });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[1] --- BOT ACTIVE ON PORT ${PORT} ---`);
  connectToWhatsApp().catch(err => console.error("Critical Start Error:", err));

  // ============ KEEP-ALIVE: Prevent Render free tier from sleeping ============
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    const httpModule = SELF_URL.startsWith("https") ? require("https") : require("http");
    httpModule.get(`${SELF_URL}/logs`, (res) => {
      console.log(`[KEEP-ALIVE] ✅ Self-ping OK → ${SELF_URL} (Status: ${res.statusCode})`);
    }).on("error", (e) => {
      console.error(`[KEEP-ALIVE] ❌ Self-ping failed: ${e.message}`);
    });
  }, 5 * 60 * 1000); // Every 5 minutes
  // ===========================================================================
});
