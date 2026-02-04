const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Driver sends location
  socket.on("driver_location", (data) => {
    // data = { trip_id, lat, lng }
    io.emit("location_update", data);
  });

  // Trip status update
  socket.on("trip_status", async (data) => {
    // data = { trip_id, status }
    await axios.post(
      `http://localhost:5000/api/trip/${data.trip_id}/status`,
      { status: data.status }
    );
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

server.listen(4000, () => {
  console.log("Realtime server running on port 4000");
});
