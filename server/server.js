const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

// Initialize express app
const app = express();

// Determine if we can use HTTPS
let server;
let protocol = 'http';
const sslDir = path.join(__dirname, '../ssl');
const keyPath = path.join(sslDir, 'key.pem');
const certPath = path.join(sslDir, 'cert.pem');

try {
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    // SSL certificates exist, use HTTPS
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    server = https.createServer(options, app);
    protocol = 'https';
    console.log('SSL certificates found. Running in HTTPS mode.');
  } else {
    // No SSL certificates, use HTTP
    server = http.createServer(app);
    console.log('SSL certificates not found. Running in HTTP mode.');
    console.log('To enable HTTPS, create ssl/key.pem and ssl/cert.pem files.');
  }
} catch (err) {
  // Error when trying to access SSL files, fall back to HTTP
  console.error('Error setting up HTTPS:', err.message);
  server = http.createServer(app);
  console.log('Falling back to HTTP mode.');
}

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Store audience connections and their codes
const audiences = new Map(); // websocket -> {code, streaming, handRaised, deviceType, seatNumber}
const codes = new Set(); // track assigned codes
const usedCodes = new Set(); // track previously used codes

// Track current streaming state
let currentStreamingCode = null; // The code of the currently streaming audience member
let isStreamActive = false; // Flag to track if any stream is active
let currentQuestion = null; // The current active question
let isQuestionOpen = false; // Flag to track if a question is active

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

// Get a list of all active audience codes
function getAudienceList() {
  const audienceList = [];
  for (const [_, info] of audiences.entries()) {
    audienceList.push({
      code: info.code,
      streaming: info.streaming,
      handRaised: info.handRaised || false,
      deviceType: info.deviceType || 'web', // Default to web if not specified
      seatNumber: info.seatNumber && info.seatNumber.trim() !== "" ? info.seatNumber : "Unknown"
    });
  }
  return audienceList;
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
        // Get seat number and ensure it's a valid string
        const seatNumber = data.seatNumber && typeof data.seatNumber === 'string' && data.seatNumber.trim() !== '' 
          ? data.seatNumber.trim() 
          : 'Unknown';
        
        // Identify iOS app connections
        const deviceType = data.deviceType || 'web'; // Default to web if not provided
        
        audiences.set(ws, { 
          code, 
          streaming: false, 
          handRaised: false, 
          seatNumber,
          deviceType 
        });
        
        ws.send(JSON.stringify({ type: 'code-assigned', code }));
        
        // If there's an active question, notify the new audience member
        if (isQuestionOpen && currentQuestion) {
          ws.send(JSON.stringify({ 
            type: 'question-opened', 
            question: currentQuestion 
          }));
        }
        
        console.log(`Assigned code ${code} to audience member at seat ${seatNumber}, device: ${deviceType}`);
        
        // Notify admins about new audience member
        broadcastToAdmins({
          type: 'audience-updated',
          audienceList: getAudienceList(),
          isStreamActive: isStreamActive,
          currentStreamingCode: currentStreamingCode,
          isQuestionOpen: isQuestionOpen,
          currentQuestion: currentQuestion
        });
        break;

      case 'select-code':
        // Check if a stream is already active
        if (isStreamActive) {
          // Reject the selection request
          ws.send(JSON.stringify({
            type: 'selection-rejected',
            reason: 'A stream is already active. Please end the current stream before selecting another audience member.'
          }));
          console.log(`Selection rejected for code ${data.code} - stream already active with code ${currentStreamingCode}`);
          return;
        }
        
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
          
          // Set global streaming state
          isStreamActive = true;
          currentStreamingCode = info.code;
          
          // Broadcast to admin that stream is active
          broadcastToAdmins({
            type: 'stream-active',
            code: info.code,
            isStreamActive: true
          });
          
          // Update audience list for admins
          broadcastToAdmins({
            type: 'audience-updated',
            audienceList: getAudienceList(),
            isStreamActive: isStreamActive,
            currentStreamingCode: currentStreamingCode
          });
          
          console.log(`Stream started for code ${info.code}`);
        }
        break;
        
      case 'end-stream':
        // Admin ends the current stream
        if (currentStreamingCode) {
          // Find the streaming audience member and update their status
          for (const [client, info] of audiences.entries()) {
            if (info.code === currentStreamingCode) {
              info.streaming = false;
              audiences.set(client, info);
              
              // Notify the audience member their stream has ended
              client.send(JSON.stringify({ type: 'stream-ended' }));
              break;
            }
          }
          
          // Reset global streaming state
          isStreamActive = false;
          const endedStreamCode = currentStreamingCode;
          currentStreamingCode = null;
          
          // Notify all admins that the stream has ended
          broadcastToAdmins({
            type: 'stream-ended',
            code: endedStreamCode,
            isStreamActive: false
          });
          
          // Update audience list for admins
          broadcastToAdmins({
            type: 'audience-updated',
            audienceList: getAudienceList(),
            isStreamActive: false,
            currentStreamingCode: null
          });
          
          console.log(`Stream ended for code ${endedStreamCode}`);
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
        
      case 'raise-hand':
        // Audience member raises hand to answer question
        if (audiences.has(ws)) {
          const info = audiences.get(ws);
          info.handRaised = true;
          audiences.set(ws, info);
          
          console.log(`Audience member with code ${info.code} raised hand`);
          
          // Update audience list for admins
          broadcastToAdmins({
            type: 'audience-updated',
            audienceList: getAudienceList(),
            isQuestionOpen: isQuestionOpen,
            currentQuestion: currentQuestion
          });
        }
        break;
        
      case 'lower-hand':
        // Audience member lowers hand
        if (audiences.has(ws)) {
          const info = audiences.get(ws);
          info.handRaised = false;
          audiences.set(ws, info);
          
          console.log(`Audience member with code ${info.code} lowered hand`);
          
          // Update audience list for admins
          broadcastToAdmins({
            type: 'audience-updated',
            audienceList: getAudienceList(),
            isQuestionOpen: isQuestionOpen,
            currentQuestion: currentQuestion
          });
        }
        break;
        
      case 'open-question':
        // Admin opens a new question
        console.log('Received open-question request from admin');
        currentQuestion = 'Yeni Soru'; // Sabit bir değer kullanıyoruz artık
        isQuestionOpen = true;
        
        // Reset all hands
        for (const [client, info] of audiences.entries()) {
          info.handRaised = false;
          audiences.set(client, info);
        }
        
        // Notify all audience members about the question
        console.log('Broadcasting question to audience members...');
        broadcastToAudience({
          type: 'question-opened',
          question: currentQuestion
        });
        
        console.log('Question opened successfully');
        
        // Update audience list for admins
        console.log('Updating admins about question state...');
        broadcastToAdmins({
          type: 'audience-updated',
          audienceList: getAudienceList(),
          isQuestionOpen: isQuestionOpen,
          currentQuestion: currentQuestion
        });
        break;
        
      case 'close-question':
        // Admin closes the current question
        console.log('Received close-question request from admin');
        isQuestionOpen = false;
        
        // Reset all hands
        for (const [client, info] of audiences.entries()) {
          info.handRaised = false;
          audiences.set(client, info);
        }
        
        // Notify all audience members that the question is closed
        console.log('Notifying audience members about question closure...');
        broadcastToAudience({
          type: 'question-closed'
        });
        
        console.log('Question closed successfully');
        
        // Update audience list for admins
        console.log('Updating admins about question closure...');
        broadcastToAdmins({
          type: 'audience-updated',
          audienceList: getAudienceList(),
          isQuestionOpen: isQuestionOpen,
          currentQuestion: currentQuestion
        });
        break;
        
      case 'register-admin':
        // Mark this connection as an admin
        console.log('Admin registration request received');
        ws.isAdmin = true;
        
        // Send current audience list to the new admin
        console.log(`Sending current state to admin: ${audiences.size} audience members, isQuestionOpen: ${isQuestionOpen}`);
        ws.send(JSON.stringify({ 
          type: 'admin-registered',
          activeAudience: audiences.size,
          audienceList: getAudienceList(),
          isStreamActive: isStreamActive,
          currentStreamingCode: currentStreamingCode,
          isQuestionOpen: isQuestionOpen,
          currentQuestion: currentQuestion
        }));
        
        console.log('Admin registered successfully');
        break;

      case 'get-audience-list':
        // Admin wants updated audience list
        console.log('Admin requested updated audience list');
        
        // Just send the current audience list to the requesting admin
        ws.send(JSON.stringify({ 
          type: 'audience-updated',
          audienceList: getAudienceList(),
          isStreamActive: isStreamActive,
          currentStreamingCode: currentStreamingCode,
          isQuestionOpen: isQuestionOpen,
          currentQuestion: currentQuestion
        }));
        break;
    }
  });
  
  ws.on('close', () => {
    // Remove audience member when they disconnect
    if (audiences.has(ws)) {
      const info = audiences.get(ws);
      const code = info.code;
      codes.delete(code);
      
      // Check if this was the streaming audience member
      if (info.streaming && code === currentStreamingCode) {
        // Reset global streaming state
        isStreamActive = false;
        currentStreamingCode = null;
        
        // Notify admins that the stream has ended
        broadcastToAdmins({
          type: 'stream-ended',
          code: code,
          reason: 'disconnected',
          isStreamActive: false
        });
      }
      
      audiences.delete(ws);
      console.log(`Audience member with code ${code} disconnected`);
      
      // Notify admins about disconnection
      broadcastToAdmins({
        type: 'audience-disconnected',
        code
      });
      
      // Update audience list for admins
      broadcastToAdmins({
        type: 'audience-updated',
        audienceList: getAudienceList(),
        isStreamActive: isStreamActive,
        currentStreamingCode: currentStreamingCode
      });
    }
    console.log('Client disconnected');
  });
});

// Helper to broadcast to all admin connections
function broadcastToAdmins(data) {
  let adminCount = 0;
  
  wss.clients.forEach((client) => {
    if (client.isAdmin && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
      adminCount++;
    }
  });
  
  console.log(`Message broadcasted to ${adminCount} admin clients.`);
}

// Helper to broadcast to all audience connections
function broadcastToAudience(data) {
  let audienceCount = 0;
  
  wss.clients.forEach((client) => {
    if (!client.isAdmin && client.readyState === WebSocket.OPEN && audiences.has(client)) {
      client.send(JSON.stringify(data));
      audienceCount++;
    }
  });
  
  console.log(`Message broadcasted to ${audienceCount} audience clients.`);
}

// Rota tanımlamaları
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/audience.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Start the server
const PORT = process.env.PORT || 3002;
server.listen(PORT, '0.0.0.0', () => {
  // Get the local IP address
  const interfaces = os.networkInterfaces();
  let localIP = '192.168.50.15';
  
  console.log(`\n---- SERVER STARTED SUCCESSFULLY ----`);
  console.log(`Running in ${protocol.toUpperCase()} mode on port ${PORT}`);
  console.log(`\nLocal Access URLs:`);
  console.log(`  Local: ${protocol}://localhost:${PORT}`);
  console.log(`  Network: ${protocol}://${localIP}:${PORT}`);
  console.log(`\nAdmin Panel:`);
  console.log(`  ${protocol}://${localIP}:${PORT}/admin.html`);
  console.log(`\n------------------------------------`);
  
  if (protocol === 'http') {
    console.log(`\nNOTE: Running in HTTP mode. Camera access might be restricted.`);
    console.log(`To enable HTTPS, create these files:`);
    console.log(`  - ${keyPath}`);
    console.log(`  - ${certPath}`);
    console.log(`\nYou can create these with the following commands:`);
    console.log(`  mkdir -p ssl`);
    console.log(`  cd ssl`);
    console.log(`  openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem`);
  }
});