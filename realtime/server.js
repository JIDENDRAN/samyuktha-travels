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

// Connect to the same database Flask uses (or customizable SQLITE_DB_PATH for persistent mount)
const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "database.db");

// Ensure parent directory exists to prevent better-sqlite3 from crashing
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

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
        <title>WhatsApp Notification Bot Status</title>
        <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
        <style>
            :root {
                --body-bg: #f6f5f3;
                --card-bg: #ffffff;
                --panel-bg: #fbfbfd;
                --border-color: #e5e5ea;
                --text-dark: #1c1c1e;
                --text-muted: #8e8e93;
                
                --red-bg: #fde8e8;
                --red-text: #e11d48;
                --green-bg: #d1fae5;
                --green-text: #059669;
                
                --primary: #ff6b35;
                --primary-hover: #ff5216;
            }

            * { box-sizing: border-box; transition: all 0.2s ease-in-out; }
            
            body {
                background: var(--body-bg);
                color: var(--text-dark);
                font-family: 'Plus Jakarta Sans', sans-serif;
                margin: 0;
                padding: 0;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }

            .main-card {
                background: var(--card-bg);
                width: 100%;
                max-width: 580px;
                border-radius: 24px;
                padding: 35px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.04);
                border: 1px solid var(--border-color);
            }

            .card-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--border-color);
                margin-bottom: 25px;
            }

            .card-header h1 {
                font-size: 20px;
                font-weight: 800;
                color: #0c2340;
                margin: 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .card-header h1 i {
                color: #ff9f0a;
            }

            .panel {
                background: var(--panel-bg);
                border: 1px solid #f2f2f7;
                border-radius: 16px;
                padding: 20px 24px;
                margin-bottom: 20px;
            }

            .status-panel {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .status-info {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .panel-label {
                font-size: 11px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: var(--text-muted);
            }

            .status-pill {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 16px;
                border-radius: 100px;
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 0.5px;
                width: fit-content;
            }

            .status-pill.disconnected {
                background: var(--red-bg);
                color: var(--red-text);
            }

            .status-pill.connected {
                background: var(--green-bg);
                color: var(--green-text);
            }

            .status-pill.connecting {
                background: #f2f2f7;
                color: #8e8e93;
            }

            .status-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: currentColor;
            }

            .status-pill.connected .status-dot {
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.25); }
                100% { opacity: 1; transform: scale(1); }
            }

            .btn-action {
                background: #ffffff;
                color: var(--text-dark);
                border: 1px solid #d1d1d6;
                padding: 10px 20px;
                border-radius: 12px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.04);
            }

            .btn-action:hover {
                background: #f2f2f7;
                transform: translateY(-1px);
            }

            .qr-panel {
                text-align: center;
                padding: 30px;
            }

            .qr-panel h3 {
                font-size: 15px;
                font-weight: 700;
                margin: 0 0 25px 0;
                color: var(--text-dark);
            }

            .qr-display {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 200px;
                margin-bottom: 25px;
            }

            .qr-image-wrapper {
                background: #ffffff;
                padding: 12px;
                border-radius: 16px;
                border: 1px solid var(--border-color);
                box-shadow: 0 4px 12px rgba(0,0,0,0.03);
            }

            .qr-image-wrapper img {
                display: block;
                width: 180px;
                height: 180px;
            }

            .spinner-wrapper {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
            }

            .spinner {
                width: 40px;
                height: 40px;
                border: 4px solid rgba(255, 107, 53, 0.15);
                border-top: 4px solid var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .qr-footer {
                font-size: 12px;
                color: var(--text-muted);
                line-height: 1.5;
                margin: 0;
            }

            .connected-panel {
                text-align: center;
                padding: 40px 20px;
            }

            .success-icon {
                font-size: 64px;
                color: #22c55e;
                margin-bottom: 20px;
            }

            .connected-panel h2 {
                font-size: 20px;
                font-weight: 700;
                margin: 0 0 10px 0;
            }

            .connected-panel p {
                font-size: 14px;
                color: var(--text-muted);
                margin: 0;
                line-height: 1.6;
            }

            .test-connection-panel {
                border-top: 1px solid var(--border-color);
                padding-top: 25px;
                margin-top: 25px;
                text-align: left;
            }

            .test-form {
                display: grid;
                grid-template-columns: 1fr;
                gap: 12px;
                margin-top: 15px;
            }

            .test-form input {
                background: #ffffff;
                border: 1px solid #d1d1d6;
                padding: 12px 16px;
                border-radius: 12px;
                color: var(--text-dark);
                font-family: inherit;
                font-size: 13px;
            }

            .test-form input:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
            }

            .btn-send {
                background: #25D366;
                color: #ffffff;
                border: none;
                padding: 12px 20px;
                border-radius: 12px;
                font-weight: 700;
                cursor: pointer;
                font-size: 13px;
                box-shadow: 0 4px 12px rgba(37, 211, 102, 0.2);
            }

            .btn-send:hover {
                filter: brightness(1.05);
                transform: translateY(-1px);
            }

            .btn-send:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .footer-note {
                font-size: 12px;
                color: var(--text-muted);
                margin-top: 20px;
                text-align: center;
            }
        </style>
    </head>
    <body>
        <div class="main-card">
            <!-- Header -->
            <div class="card-header">
                <h1><i class="fa-solid fa-bolt"></i> WhatsApp Notification Bot Status</h1>
            </div>

            <!-- Bot Status Panel -->
            <div class="panel status-panel">
                <div class="status-info">
                    <span class="panel-label">Bot Status</span>
                    <div id="status-badge" class="status-pill disconnected">
                        <div class="status-dot"></div>
                        <span id="status-text">DISCONNECTED</span>
                    </div>
                </div>
                <button class="btn-action" onclick="reconnectBot()" id="btn-reconnect">Reconnect Bot</button>
            </div>

            <!-- Lower Box: QR Panel -->
            <div id="qr-panel" class="panel qr-panel">
                <h3>Scan QR code using WhatsApp Link a Device:</h3>
                
                <div class="qr-display">
                    <!-- Spinner View -->
                    <div id="qr-spinner" class="spinner-wrapper">
                        <div class="spinner"></div>
                        <span style="color: var(--text-muted); font-size: 13px;">Waiting for server to generate QR code...</span>
                    </div>
                    <!-- QR View -->
                    <div id="qr-image-wrapper" class="qr-image-wrapper" style="display: none;">
                        <img id="qr-img" src="" alt="WhatsApp Connection QR">
                    </div>
                </div>

                <p class="qr-footer">Open WhatsApp on your phone → Tap Menu or Settings → Linked Devices → Link a Device.</p>
            </div>

            <!-- Lower Box: Connected Panel -->
            <div id="connected-panel" class="panel connected-panel" style="display: none;">
                <div class="success-icon">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h2>WhatsApp Connected</h2>
                <p>Your WhatsApp bot is active and successfully authenticated.</p>

                <!-- Test Connection Form -->
                <div class="test-connection-panel">
                    <span class="panel-label" style="text-align: center; display: block; margin-bottom: 5px;">🧪 Test Connection</span>
                    <div class="test-form">
                        <input type="text" id="phone" placeholder="Phone (10 digits)">
                        <input type="text" id="msg" placeholder="Test Message">
                        <button id="send-btn" class="btn-send" onclick="sendTest()">SEND MESSAGE</button>
                    </div>
                    <div id="msg-status" style="margin-top: 15px; font-size: 13px; text-align: center;"></div>
                </div>
            </div>
        </div>

        <div class="footer-note">
            Note: Session credentials are stored securely in SQLite and persist across restarts.
        </div>

        <script>
            const socket = io();
            const statusBadge = document.getElementById('status-badge');
            const statusText = document.getElementById('status-text');
            const qrPanel = document.getElementById('qr-panel');
            const qrSpinner = document.getElementById('qr-spinner');
            const qrImageWrapper = document.getElementById('qr-image-wrapper');
            const qrImg = document.getElementById('qr-img');
            const connectedPanel = document.getElementById('connected-panel');
            const btnReconnect = document.getElementById('btn-reconnect');

            socket.on('status', (status) => {
                statusText.innerText = status;
                
                // Update Badge Class
                statusBadge.className = 'status-pill';
                if (status === 'ONLINE') {
                    statusBadge.classList.add('connected');
                    connectedPanel.style.display = 'block';
                    qrPanel.style.display = 'none';
                } else if (status === 'INITIALIZING...' || status === 'RECONNECTING...') {
                    statusBadge.classList.add('connecting');
                    connectedPanel.style.display = 'none';
                    qrPanel.style.display = 'block';
                } else {
                    statusBadge.classList.add('disconnected');
                    connectedPanel.style.display = 'none';
                    qrPanel.style.display = 'block';
                }
            });

            socket.on('qr', (dataUrl) => {
                if (dataUrl) {
                    qrImg.src = dataUrl;
                    qrSpinner.style.display = 'none';
                    qrImageWrapper.style.display = 'block';
                } else {
                    qrImageWrapper.style.display = 'none';
                    qrSpinner.style.display = 'flex';
                }
            });

            async function reconnectBot() {
                btnReconnect.disabled = true;
                btnReconnect.innerText = "Reconnecting...";
                
                try {
                    const res = await fetch('/api/reconnect', { method: 'POST' });
                    const data = await res.json();
                    if(data.success) {
                        qrImg.src = '';
                        qrImageWrapper.style.display = 'none';
                        qrSpinner.style.display = 'flex';
                    }
                } catch (e) {
                    console.error("Failed to trigger reconnect:", e);
                } finally {
                    setTimeout(() => {
                        btnReconnect.disabled = false;
                        btnReconnect.innerText = "Reconnect Bot";
                    }, 3000);
                }
            }

            async function sendTest() {
                const phone = document.getElementById('phone').value;
                const message = document.getElementById('msg').value;
                const sendBtn = document.getElementById('send-btn');
                const msgStatus = document.getElementById('msg-status');
                if(!phone || !message) return;
                
                sendBtn.disabled = true;
                msgStatus.innerText = "⏳ Sending...";
                msgStatus.style.color = "var(--text-muted)";
                
                try {
                    const res = await fetch('/api/send-whatsapp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone, message })
                    });
                    const data = await res.json();
                    msgStatus.innerText = data.success ? "✅ Success!" : "❌ " + data.error;
                    msgStatus.style.color = data.success ? "var(--green-text)" : "var(--red-text)";
                } catch (e) {
                    msgStatus.innerText = "❌ Network Error";
                    msgStatus.style.color = "var(--red-text)";
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
        browser: ["Samyuktha Travels", "Chrome", "20.0.04"],
        syncFullHistory: false,
        fireInitQueries: false
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

// ================= RECONNECT BOT API =================
app.post("/api/reconnect", async (req, res) => {
    try {
        console.log("🧹 [AUTH] Reconnect requested. Clearing SQLite session...");
        db.prepare('DELETE FROM whatsapp_auth').run();
        if (sock) {
            // Logout closes connection and triggers clearState inside connection.update
            await sock.logout().catch(() => {});
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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
