const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const bodyParser = require("body-parser");
const { execSync } = require("child_process");
const path = require("path");

console.log("\n[1] --- SERVER STARTING ---");

// ================= ERROR LOGGING =================
process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[2] --- HTTP SERVER LIVE ON PORT ${PORT} ---`);
});

// ================= RENDER CHROMIUM SETUP =================
console.log("[3] --- DETECTING CHROME BINARY ---");
let executablePath = null;
try {
  const output = execSync("npx puppeteer browsers install chrome --path .cache/puppeteer --print-path").toString().trim();
  const parts = output.split(" ");
  const rawPath = parts[parts.length - 1];
  executablePath = path.resolve(process.cwd(), rawPath);
  console.log(`[4] --- CHROME FOUND AT: ${executablePath} ---`);
} catch (err) {
  console.log("[!] --- AUTO-DETECTION FAILED, USING DEFAULT BROWSER ---");
}

// ================= WHATSAPP BOT SETUP =================
console.log("[5] --- INITIALIZING WHATSAPP CLIENT ---");
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process"
    ],
  }
});

client.on("qr", (qr) => {
  console.log("\n⚠️ [QR ACTION] SCAN THE CODE BELOW:");
  console.log("Raw QR Link (Use with online generator if needed):", qr);
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("\n✅ [READY] WHATSAPP ENGINE IS ONLINE! 🚀\n");
});

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ [LOADING] ${percent}% - ${message}`);
});

client.on("auth_failure", (msg) => {
  console.error("❌ [AUTH ERROR]:", msg);
});

// Restart on crash
client.on("disconnected", (reason) => {
  console.log("(!) Client was logged out", reason);
  client.initialize();
});

// API for Python Flask App
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "Missing data" });

  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const formattedPhone = cleanPhone.includes("@c.us") ? cleanPhone : `${cleanPhone}@c.us`;
    await client.sendMessage(formattedPhone, message);
    console.log(`✅ Message sent to ${formattedPhone}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Send Error:", err);
    res.status(500).json({ error: "Failed to send", details: err.message });
  }
});

client.initialize().catch(err => {
  console.error("❌ [STARTUP ERROR]:", err);
});

// ================= SOCKET.IO =================
io.on("connection", (socket) => {
  socket.on("driver_location", (data) => {
    io.emit("location_update", data);
  });

  socket.on("trip_status", async (data) => {
    try {
      const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5000";
      await axios.post(`${flaskUrl}/api/trip/${data.trip_id}/status`, { status: data.status });
    } catch (err) {
      console.error("Error updating trip status:", err.message);
    }
  });
});
