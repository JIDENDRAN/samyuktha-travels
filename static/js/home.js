const hero = document.getElementById("hero");

const images = [
  "https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?auto=format&fit=crop&w=1600&q=60",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=60",
  "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1600&q=60",
  "https://images.unsplash.com/photo-1586500036706-41963de24d8b?auto=format&fit=crop&w=1600&q=60"
];

let i = 0;
function setBg() {
  hero.style.backgroundImage = `url('${images[i]}')`;
  i = (i + 1) % images.length;
}
setBg();
setInterval(setBg, 4500);
