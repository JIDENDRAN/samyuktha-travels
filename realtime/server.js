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

// ================= ERROR LOGGING =================
process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" },
});

// ================= RENDER CHROMIUM SETUP =================
let executablePath = null;
try {
  // Fix: split by space and take the last part (the path)
  const output = execSync("npx puppeteer browsers install chrome --path .cache/puppeteer --print-path").toString().trim();
  const parts = output.split(" ");
  const rawPath = parts[parts.length - 1]; // Use the last part
  executablePath = path.resolve(process.cwd(), rawPath); // Make it absolute
  console.log(`📍 Real Chrome path: ${executablePath}`);
} catch (err) {
  console.log("⚠️ Could not auto-detect Chrome, will use default.");
}

// ================= WHATSAPP BOT SETUP =================
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
      "--no-zygote"
    ],
  }
});

console.log("🚀 Initializing WhatsApp Engine...");

client.on("qr", (qr) => {
  console.log("\n⚠️ ACTION REQUIRED: SCAN THE QR CODE BELOW!");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("\n✅ WhatsApp Engine is READY! 🚀\n");
});

client.on("disconnected", (reason) => {
  console.log("Client was logged out", reason);
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
  console.error("❌ FAILED TO INITIALIZE WHATSAPP:", err);
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

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Realtime server running on port ${PORT}`);
});
