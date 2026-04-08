const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay,
    BufferJSON,
    initAuthCreds
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const express = require("express");
const http = require("http");
const bodyParser = require("body-parser");
const cors = require("cors");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const pino = require("pino");
const path = require("path");
const socketIO = require("socket.io");
const Database = require("better-sqlite3");

// Connect to the same database Flask uses
const db = new Database(path.join(__dirname, "..", "database.db"));

// Initialize Auth Table for SQLite session storage
db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth (
        id TEXT PRIMARY KEY,
        data TEXT
    )
`);

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

// ================= CUSTOM SQLITE AUTH STATE =================
async function useSQLiteAuthState() {
    const credsId = 'creds';
    
    const readData = (id) => {
        try {
            const row = db.prepare('SELECT data FROM whatsapp_auth WHERE id = ?').get(id);
            return row ? JSON.parse(row.data, BufferJSON.reviver) : null;
        } catch (e) {
            console.error(`[SQL] Read Error (${id}):`, e.message);
            return null;
        }
    };

    const writeData = (data, id) => {
        try {
            const json = JSON.stringify(data, BufferJSON.replacer);
            db.prepare('INSERT OR REPLACE INTO whatsapp_auth (id, data) VALUES (?, ?)').run(id, json);
        } catch (e) {
            console.error(`[SQL] Write Error (${id}):`, e.message);
        }
    };

    const removeData = (id) => {
        try {
            db.prepare('DELETE FROM whatsapp_auth WHERE id = ?').run(id);
        } catch (e) {
            console.error(`[SQL] Delete Error (${id}):`, e.message);
        }
    };

    const creds = readData(credsId) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        data[id] = readData(`${type}-${id}`);
                    }
                    return data;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            const key = `${type}-${id}`;
                            if (value) writeData(value, key);
                            else removeData(key);
                        }
                    }
                }
            }
        },
        saveCreds: () => writeData(creds, credsId),
        clearState: () => {
            db.prepare('DELETE FROM whatsapp_auth').run();
            console.log("🧹 [AUTH] Database session cleared.");
        }
    };
}

app.get("/logs", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot Dashboard | Samyuktha</title>
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
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: var(--text-dim);
                margin-bottom: 20px;
                font-weight: 700;
            }

            .qr-container {
                text-align: center;
                display: none;
            }

            .qr-image {
                background: #fff;
                padding: 15px;
                border-radius: 16px;
                display: inline-block;
                margin-bottom: 20px;
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
                font-size: 12px;
                padding: 15px;
                background: rgba(0,0,0,0.4);
                border-radius: 15px;
                border: 1px solid rgba(255,255,255,0.05);
            }

            .log-entry {
                padding: 6px 0;
                border-bottom: 1px solid rgba(255,255,255,0.03);
                white-space: pre-wrap;
            }

            .log-timestamp { color: var(--text-dim); margin-right: 10px; }
            .log-info { color: var(--primary); }
            .log-error { color: var(--error); }

            .input-group {
                display: grid;
                grid-template-columns: 1fr 2fr auto;
                gap: 12px;
            }

            input {
                background: rgba(255,255,255,0.05);
                border: 1px solid var(--border);
                padding: 12px 18px;
                border-radius: 10px;
                color: #fff;
                font-family: inherit;
            }

            input:focus { outline: none; border-color: var(--primary); }

            button {
                background: var(--primary);
                color: #000;
                border: none;
                padding: 0 20px;
                border-radius: 10px;
                font-weight: 700;
                cursor: pointer;
            }

            button:hover { filter: brightness(1.1); transform: translateY(-1px); }
            button:disabled { opacity: 0.5; cursor: not-allowed; }

            ::-webkit-scrollbar { width: 4px; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        </style>
    </head>
    <body>
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>

        <div class="container">
            <header>
                <h1>🚀 WhatsApp Persistence</h1>
                <div id="status-badge" class="status-badge">
                    <div class="status-dot"></div>
                    <span id="status-text">CONNECTING...</span>
                </div>
            </header>

            <div id="qr-card" class="card qr-container">
                <div class="card-title">🔑 LOGIN REQUIRED (SQLITE)</div>
                <div class="qr-image">
                    <img id="qr-img" src="" alt="Scan this QR">
                </div>
                <p style="color: var(--text-dim); font-size: 14px;">Scan with WhatsApp Linked Devices. Session will be saved to your Database.</p>
            </div>

            <div class="card">
                <div class="card-title">🧪 TEST CONNECTION</div>
                <div class="input-group">
                    <input type="text" id="phone" placeholder="Phone (10 digits)">
                    <input type="text" id="msg" placeholder="Test Message">
                    <button id="send-btn" onclick="sendTest()">SEND</button>
                </div>
                <div id="msg-status" style="margin-top: 10px; font-size: 13px;"></div>
            </div>

            <div class="card">
                <div class="card-title">📋 SYSTEM LOGS</div>
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

            socket.on('log', addLog);
            socket.on('logs', (history) => {
                logsContainer.innerHTML = '';
                history.forEach(addLog);
            });

            function addLog(log) {
                const div = document.createElement('div');
                div.className = 'log-entry';
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
                msgStatus.innerText = "⏳ Sending...";
                
                try {
                    const res = await fetch('/api/send-whatsapp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, message })
                    });
                    const data = await res.json();
                    msgStatus.innerText = data.success ? "✅ Success!" : "❌ " + data.error;
                    msgStatus.style.color = data.success ? "var(--primary)" : "var(--error)";
                } catch (e) {
                    msgStatus.innerText = "❌ Network Error";
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
    socket.emit("status", sock && sock.user ? "ONLINE" : "INITIALIZING...");
    if (lastQrDataUrl) socket.emit("qr", lastQrDataUrl);
    socket.emit("logs", logHistory);
});

let sock;

async function connectToWhatsApp() {
    console.log("🔄 [AUTH] Initializing SQLite Session Storage...");
    const { state, saveCreds, clearState } = await useSQLiteAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: pino({ level: "error" }),
        // Using a more stable browser identity
        browser: ["Samyuktha Travels", "Chrome", "20.0.04"]
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
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            lastQrDataUrl = "";
            io.emit("qr", "");

            if (statusCode === DisconnectReason.loggedOut) {
                console.log("⚠️ [AUTH] Device logged out. Clearing Database session...");
                io.emit("status", "LOGGED OUT - RESETTING...");
                clearState();
                setTimeout(() => connectToWhatsApp(), 2000);
            } else {
                io.emit("status", "RECONNECTING...");
                console.log(`❌ Connection closed (Code: ${statusCode}). Reconnecting...`);
                setTimeout(() => connectToWhatsApp(), 3000);
            }
        } else if (connection === "open") {
            lastQrDataUrl = "";
            io.emit("qr", "");
            io.emit("status", "ONLINE");
            console.log("✅ [READY] WhatsApp is Online! Session secured in SQLite.");
        }
    });

    sock.ev.on("creds.update", async () => {
        await saveCreds();
        console.log("💾 [AUTH] Session updated in Database.");
    });
}

// ================= SEND WHATSAPP API =================
app.post("/api/send-whatsapp", async (req, res) => {
    const { phone, message } = req.body;
    
    if (!sock || !sock.user) {
        return res.status(503).json({ success: false, error: "Bot not logged in. Visit /logs to scan QR." });
    }

    let cleanPhone = phone.toString().replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
    const chatId = `${cleanPhone}@s.whatsapp.net`;

    try {
        await sock.sendMessage(chatId, { text: message });
        console.log(`✅ [SENT] Message to ${chatId}`);
        return res.json({ success: true });
    } catch (err) {
        console.error(`❌ [ERROR] ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`[1] --- BOT ACTIVE ON PORT ${PORT} ---`);
    connectToWhatsApp().catch(err => console.error("Critical Start Error:", err));

    // Keep-alive to prevent sleep
    const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(() => {
        const httpModule = SELF_URL.startsWith("https") ? require("https") : require("http");
        httpModule.get(`${SELF_URL}/logs`, (res) => {
            if(res.statusCode === 200) console.log("[KEEP-ALIVE] Ping OK");
        }).on("error", () => {});
    }, 5 * 60 * 1000);
});
