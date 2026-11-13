const net = require('node:net');

const socket = net.createConnection(process.env.AIDERDESK_SUDO_SOCKET || '');
let response = '';
socket.setEncoding('utf8');
socket.setTimeout(180000, () => socket.destroy());
socket.on('connect', () => socket.write(JSON.stringify({ prompt: process.argv[2] || 'sudo password', pid: process.ppid }) + '\n'));
socket.on('data', (data) => {
  response += data;
  if (response.length > 65536) socket.destroy();
});
socket.on('end', () => {
  try {
    const data = JSON.parse(response);
    if (typeof data.password === 'string') {
      process.stdout.write(data.password + '\n');
      return;
    }
  } catch {}
  process.exitCode = 1;
});
socket.on('error', () => {
  process.exitCode = 1;
});
socket.on('close', () => {
  if (!response) process.exitCode = 1;
});
