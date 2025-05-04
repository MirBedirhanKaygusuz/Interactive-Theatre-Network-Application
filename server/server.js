const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Initialize express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Store audience connections and their codes
const audiences = new Map(); // websocket -> {code, streaming}
const codes = new Set(); // track assigned codes
const usedCodes = new Set(); // track previously used codes

// Generate a random 4-character code
function generateUniqueCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed similar looking chars
  let code;
  
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      code += characters.charAt(randomIndex);
    }
  } while (codes.has(code) || usedCodes.has(code));
  
  codes.add(code);
  return code;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case 'register-audience':
        // Assign a unique code to the audience member
        const code = generateUniqueCode();
        audiences.set(ws, { code, streaming: false });
        ws.send(JSON.stringify({ type: 'code-assigned', code }));
        console.log(`Assigned code ${code} to an audience member`);
        break;
        
      case 'select-code':
        // Admin selects a code to activate
        const selectedCode = data.code;
        let targetWs = null;
        
        // Find the audience member with the matching code
        for (const [client, info] of audiences.entries()) {
          if (info.code === selectedCode) {
            targetWs = client;
            break;
          }
        }
        
        if (targetWs) {
          // Notify the selected audience member
          targetWs.send(JSON.stringify({ type: 'you-selected' }));
          
          // Notify admin that audience member was found
          ws.send(JSON.stringify({ 
            type: 'audience-found',
            code: selectedCode
          }));
          
          // Remove the code from active codes and add to used codes
          codes.delete(selectedCode);
          usedCodes.add(selectedCode);
          
          console.log(`Audience member with code ${selectedCode} selected`);
        } else {
          // Notify admin that no audience member with this code was found
          ws.send(JSON.stringify({ 
            type: 'audience-not-found',
            code: selectedCode
          }));
          console.log(`No audience member found with code ${selectedCode}`);
        }
        break;
        
      case 'stream-started':
        // Audience member confirms their stream has started
        if (audiences.has(ws)) {
          const info = audiences.get(ws);
          info.streaming = true;
          audiences.set(ws, info);
          
          // Broadcast to admin that stream is active
          broadcastToAdmins({
            type: 'stream-active',
            code: info.code
          });
          console.log(`Stream started for code ${info.code}`);
        }
        break;
        
      case 'stream-offer':
        // Audience member sends WebRTC offer
        const offer = data.offer;
        const audienceCode = audiences.get(ws)?.code;
        
        // Forward the offer to admin clients
        broadcastToAdmins({
          type: 'stream-offer',
          offer,
          code: audienceCode
        });
        break;
        
      case 'stream-answer':
        // Admin sends WebRTC answer
        const answer = data.answer;
        const targetCode = data.code;
        
        // Find audience with matching code and forward answer
        for (const [client, info] of audiences.entries()) {
          if (info.code === targetCode) {
            client.send(JSON.stringify({
              type: 'stream-answer',
              answer
            }));
            break;
          }
        }
        break;
        
      case 'ice-candidate':
        // ICE candidate exchange
        const candidate = data.candidate;
        const forCode = data.code;
        
        if (forCode) {
          // From admin to specific audience
          for (const [client, info] of audiences.entries()) {
            if (info.code === forCode) {
              client.send(JSON.stringify({
                type: 'ice-candidate',
                candidate
              }));
              break;
            }
          }
        } else {
          // From audience to admin
          broadcastToAdmins({
            type: 'ice-candidate',
            candidate,
            code: audiences.get(ws)?.code
          });
        }
        break;
        
      case 'register-admin':
        // Mark this connection as an admin
        ws.isAdmin = true;
        ws.send(JSON.stringify({ 
          type: 'admin-registered',
          activeAudience: audiences.size
        }));
        console.log('Admin registered');
        break;
    }
  });
  
  ws.on('close', () => {
    // Remove audience member when they disconnect
    if (audiences.has(ws)) {
      const code = audiences.get(ws).code;
      codes.delete(code);
      audiences.delete(ws);
      console.log(`Audience member with code ${code} disconnected`);
      
      // Notify admins about disconnection
      broadcastToAdmins({
        type: 'audience-disconnected',
        code
      });
    }
    console.log('Client disconnected');
  });
});

// Helper to broadcast to all admin connections
function broadcastToAdmins(data) {
  wss.clients.forEach((client) => {
    if (client.isAdmin && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Connect to http://localhost:${PORT} from your device`);
});