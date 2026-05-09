const http = require('http');
const { createApp } = require('./create-app');

function createServer() {
  const app = createApp();
  const server = http.createServer(app);
  return { app, server };
}

module.exports = { createServer };
