const socket = io("http://127.0.0.1:5000");

let map;
let markers = {};

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 20.5937, lng: 78.9629 },
    zoom: 5
  });
}

window.onload = initMap;

socket.on("location_update", (data) => {
  console.log("Live location:", data);

  if (markers[data.trip_id]) {
    markers[data.trip_id].setPosition({ lat: data.lat, lng: data.lng });
  } else {
    const marker = new google.maps.Marker({
      position: { lat: data.lat, lng: data.lng },
      map: map,
      title: `Trip ${data.trip_id}`,
      icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
    });
    markers[data.trip_id] = marker;
  }

  map.panTo({ lat: data.lat, lng: data.lng });
});
