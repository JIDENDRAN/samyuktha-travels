const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" },
});

// ================= FREE WHATSAPP BOT SETUP =================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true, // Run in background
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--unhandled-rejections=strict"],
  },
  // Stable web version to prevent "Execution context was destroyed"
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  }
});

console.log("🚀 Starting WhatsApp Engine initialization...");

// QR Code for First Time Login
client.on("qr", (qr) => {
  console.log("\n⚠️ ACTION REQUIRED: NEW QR CODE DETECTED!");
  console.log("==================================================");
  console.log("SCAN THIS QR CODE WITH WHATSAPP TO CONNECT YOUR BOT:");
  console.log(qr); // Adding raw QR string for alternate debugging
  qrcode.generate(qr, { small: true });
  console.log("==================================================\n");
});

client.on("ready", () => {
  console.log("\n✅ SUCCESS: WhatsApp Engine is READY! 🚀\n");
});

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
});

client.on("authenticated", () => {
  console.log("✅ Authenticated successfully!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failure:", msg);
});

// Restart on crash
client.on("disconnected", (reason) => {
  console.log("Client was logged out", reason);
  client.initialize();
});

// API for Python Flask App to send automatically
app.post("/api/send-whatsapp", async (req, res) => {
  const { phone, message } = req.body;
  
  if (!phone || !message) {
    return res.status(400).json({ error: "Missing phone or message" });
  }

  try {
    const cleanPhone = phone.replace("+", "").replace("-", "").replace(" ", "");
    const formattedPhone = cleanPhone.includes("@c.us") ? cleanPhone : `${cleanPhone}@c.us`;
    
    await client.sendMessage(formattedPhone, message);
    console.log(`✅ Message sent to ${formattedPhone}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending message:", err);
    res.status(500).json({ error: "Failed to send message", details: err.message });
  }
});

client.initialize();

// ================= SOCKET.IO (Existing Logic) =================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("driver_location", (data) => {
    io.emit("location_update", data);
  });

  socket.on("trip_status", async (data) => {
    try {
      const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5000";
      await axios.post(`${flaskUrl}/api/trip/${data.trip_id}/status`, {
        status: data.status,
      });
    } catch (err) {
      console.error("Error updating trip status:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n-----------------------------------------`);
  console.log(`🚀 Realtime server running on port ${PORT}`);
  console.log(`-----------------------------------------\n`);
});
