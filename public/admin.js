// Connect to WebSocket server
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
const socket = new WebSocket(wsUrl);

// DOM elements
const connectionStatus = document.getElementById('connection-status');
const audienceCount = document.getElementById('audience-count');
const codeInput = document.getElementById('code-input');
const selectBtn = document.getElementById('select-btn');
const randomBtn = document.getElementById('random-btn');
const selectionStatus = document.getElementById('selection-status');
const remoteVideo = document.getElementById('remote-video');
const noStreamMessage = document.getElementById('no-stream-message');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const endStreamBtn = document.getElementById('end-stream-btn');

// WebRTC variables
let peerConnection;
let currentCode = null;

// When the WebSocket connection is established
socket.onopen = () => {
  console.log('Connected to server');
  connectionStatus.textContent = 'Connected';
  connectionStatus.classList.add('connected');
  
  // Register as admin
  socket.send(JSON.stringify({ type: 'register-admin' }));
};

// Handle messages from the server
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'admin-registered':
      audienceCount.textContent = `${data.activeAudience} audience members connected`;
      break;
      
    case 'audience-found':
      selectionStatus.textContent = `Audience member with code ${data.code} selected. Waiting for them to accept...`;
      selectionStatus.classList.add('success');
      currentCode = data.code;
      break;
      
    case 'audience-not-found':
      selectionStatus.textContent = `No audience member found with code ${data.code}`;
      selectionStatus.classList.add('error');
      setTimeout(() => {
        selectionStatus.textContent = '';
        selectionStatus.classList.remove('error');
      }, 3000);
      break;
      
    case 'stream-active':
      selectionStatus.textContent = `Stream active for code ${data.code}`;
      noStreamMessage.style.display = 'none';
      endStreamBtn.disabled = false;
      break;
      
    case 'stream-offer':
      // Process WebRTC offer from audience
      handleStreamOffer(data.offer, data.code);
      break;
      
    case 'ice-candidate':
      // Add ICE candidate from audience
      if (peerConnection && data.code === currentCode) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
      break;
      
    case 'audience-disconnected':
      if (data.code === currentCode) {
        selectionStatus.textContent = `Audience member with code ${data.code} disconnected`;
        selectionStatus.classList.add('error');
        endStream();
      }
      break;
  }
};

// Handle connection errors
socket.onerror = (error) => {
  console.error('WebSocket error:', error);
  connectionStatus.textContent = 'Connection Error';
  connectionStatus.classList.add('error');
};

// Handle connection closing
socket.onclose = () => {
  console.log('Disconnected from server');
  connectionStatus.textContent = 'Disconnected';
  connectionStatus.classList.remove('connected');
  connectionStatus.classList.add('error');
};

// Select audience member by code
selectBtn.addEventListener('click', () => {
  const code = codeInput.value.toUpperCase();
  if (code.length === 4) {
    socket.send(JSON.stringify({
      type: 'select-code',
      code: code
    }));
    selectionStatus.textContent = `Selecting code ${code}...`;
    selectionStatus.classList.remove('error', 'success');
  } else {
    selectionStatus.textContent = 'Please enter a valid 4-character code';
    selectionStatus.classList.add('error');
  }
});

// Handle random selection button
randomBtn.addEventListener('click', () => {
  // Request server to select a random audience member
  // For the MVP, we just generate a random code
  // In a full version, this would ask the server for available codes
  
  // Generate a random 4-character code
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  
  codeInput.value = code;
  selectBtn.click(); // Trigger the select button click
});

// Handle fullscreen button
fullscreenBtn.addEventListener('click', () => {
  if (remoteVideo.requestFullscreen) {
    remoteVideo.requestFullscreen();
  } else if (remoteVideo.webkitRequestFullscreen) {
    remoteVideo.webkitRequestFullscreen();
  } else if (remoteVideo.msRequestFullscreen) {
    remoteVideo.msRequestFullscreen();
  }
});

// Handle end stream button
endStreamBtn.addEventListener('click', () => {
  endStream();
});

// Process WebRTC offer from audience
function handleStreamOffer(offer, code) {
  if (peerConnection) {
    peerConnection.close();
  }
  
  // Configure ICE servers
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };
  
  peerConnection = new RTCPeerConnection(configuration);
  
  // Handle incoming tracks (video/audio)
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };
  
  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ice-candidate',
        candidate: event.candidate,
        code: code
      }));
    }
  };
  
  // Log connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'failed' ||
        peerConnection.connectionState === 'closed') {
      endStream();
    }
  };
  
  // Set the remote description (offer from audience)
  peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    .then(() => {
      console.log('Remote description set');
      // Create answer
      return peerConnection.createAnswer();
    })
    .then((answer) => {
      console.log('Answer created');
      // Set local description (our answer)
      return peerConnection.setLocalDescription(answer);
    })
    .then(() => {
      console.log('Local description set, sending answer');
      // Send answer to audience
      socket.send(JSON.stringify({
        type: 'stream-answer',
        answer: peerConnection.localDescription,
        code: code
      }));
    })
    .catch((error) => {
      console.error('Error during WebRTC setup:', error);
    });
}

// End the current stream
function endStream() {
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  noStreamMessage.style.display = 'block';
  endStreamBtn.disabled = true;
  currentCode = null;
  selectionStatus.textContent = 'Stream ended';
}