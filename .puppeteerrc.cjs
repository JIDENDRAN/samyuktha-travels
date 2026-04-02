const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to a folder inside your project
  // This ensures Chrome is available at runtime on Render
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
