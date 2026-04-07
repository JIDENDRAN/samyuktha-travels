const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const bodyParser = require("body-parser");
const path = require("path");

console.log("\n[1] --- DOCKER SERVER STARTING ---");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

// For Render Docker, prioritize PORT 10000 if not specified
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[2] --- HTTP SERVER LIVE ON PORT ${PORT} ---`);
});

// ================= WHATSAPP BOT SETUP =================
console.log("[3] --- INITIALIZING WHATSAPP CLIENT (DOCKER MODE) ---");

let lastQrCode = null;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    // Use the environment variable if set (for Docker), otherwise let Puppeteer find its own (for Local dev)
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--no-first-run",
      "--disable-extensions",
      "--disable-accelerated-2d-canvas"
    ],
  }
});

client.on("qr", (qr) => {
  lastQrCode = qr;
  console.log("\n⚠️ [QR ACTION] SCAN THE CODE IN THE /SCAN PAGE!");
  qrcode.generate(qr, { small: true });
});

app.get("/", (req, res) => {
  const status = lastQrCode ? "WAITING FOR SCAN" : "READY OR CONNECTING...";
  res.send(`<h1>WhatsApp Status: ${status}</h1><p><a href="/scan">Scan Page</a></p>`);
});

app.get("/scan", (req, res) => {
  if (lastQrCode) {
    res.send(`
      <html>
        <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
          <h2>Scan with WhatsApp</h2>
          <div id="qrcode"></div>
          <p>Go to WhatsApp -> Linked Devices -> Link a Device</p>
          <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
          <script>new QRCode(document.getElementById("qrcode"), "${lastQrCode}"); setTimeout(() => window.location.reload(), 30000);</script>
        </body>
      </html>
    `);
  } else {
    res.send("<h2>Bot is loading...</h2><p>Wait 10 seconds and refresh.</p>");
  }
});

client.on("ready", () => {
  console.log("\n✅ [READY] WHATSAPP ENGINE IS ONLINE! 🚀\n");
});

client.on("auth_failure", (msg) => {
  console.error("❌ [AUTH ERROR]: Authentication failed:", msg);
});

console.log("[4] --- STARTING WHATSAPP CLIENT INITIALIZATION ---");
client.initialize().then(() => {
  console.log("[5] --- INITIALIZE COMMAND SENT ---");
}).catch(err => {
  console.error("❌ [STARTUP ERROR]: Critical failure during initialization:", err);
});

// ================= SEND WHATSAPP API =================
// Called by Flask (app.py) whenever a new booking is placed.
// The sender = whichever WhatsApp account is logged into this bot (8754720031).
// The receiver = phone passed in the request body (8300302815 = owner).
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  console.log(`\n📨 [NEW REQUEST] Attempting to send message to: ${phone}`);

  if (!phone || !message) {
    console.warn("⚠️ [REJECTED] Missing phone or message in request body.");
    return res.status(400).json({ success: false, error: "phone and message are required" });
  }

  // Ensure E.164 format without the '+': e.g. "918300302815@c.us"
  let cleanPhone = phone.toString().replace(/\D/g, ""); // strip non-digits
  if (!cleanPhone.startsWith("91")) {
    cleanPhone = "91" + cleanPhone;
  }
  const chatId = `${cleanPhone}@c.us`;

  try {
    const state = await client.getState().catch(() => "DISCONNECTED");
    console.log(`ℹ️ [STATE CHECK] WhatsApp Client State: ${state}`);

    if (state !== "CONNECTED") {
      console.warn(`⚠️ [NOT CONNECTED] Message CANNOT be sent. Please scan the QR code first. (Target: ${chatId})`);
      return res.status(503).json({ success: false, error: `WhatsApp not connected. State: ${state}` });
    }

    console.log(`🚀 [SENDING] Dispatching message to ${chatId}...`);
    await client.sendMessage(chatId, message);
    console.log(`✅ [SUCCESS] WhatsApp alert successfully delivered to ${chatId}`);
    return res.json({ success: true, to: chatId });
  } catch (err) {
    console.error(`❌ [FAILED] Error sending to ${chatId}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================= SOCKET.IO =================
io.on("connection", (socket) => {
  socket.on("driver_location", (data) => {
    io.emit("location_update", data);
  });

  socket.on("trip_status", async (data) => {
    try {
      const flaskUrl = process.env.FLASK_API_URL || "https://maduraisamyukthatravels.com";
      await axios.post(`${flaskUrl}/api/trip/${data.trip_id}/status`, { status: data.status });
    } catch (err) {
      console.error("Error updating trip status:", err.message);
    }
  });
});
