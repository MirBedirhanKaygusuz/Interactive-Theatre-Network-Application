// Connect to WebSocket server
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
const socket = new WebSocket(wsUrl);

// DOM elements
const welcomeScreen = document.getElementById('welcome-screen');
const codeScreen = document.getElementById('code-screen');
const selectedScreen = document.getElementById('selected-screen');
const streamingScreen = document.getElementById('streaming-screen');
const streamEndedScreen = document.getElementById('stream-ended-screen');
const codeDisplay = document.getElementById('code-display');
const getCodeBtn = document.getElementById('get-code-btn');
const allowMediaBtn = document.getElementById('allow-media-btn');
const returnBtn = document.getElementById('return-btn');
const localVideo = document.getElementById('local-video');

// WebRTC variables
let peerConnection;
let localStream;

// When the WebSocket connection is established
socket.onopen = () => {
  console.log('Connected to server');
};

// Handle messages from the server
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch(data.type) {
    case 'code-assigned':
      // Display the assigned code
      codeDisplay.textContent = data.code;
      welcomeScreen.classList.add('hidden');
      codeScreen.classList.remove('hidden');
      break;
      
    case 'you-selected':
      // Show the selection screen
      codeScreen.classList.add('hidden');
      selectedScreen.classList.remove('hidden');
      break;
      
    case 'stream-answer':
      // Set remote description from admin
      if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
          .catch(error => console.error('Error setting remote description:', error));
      }
      break;
      
    case 'ice-candidate':
      // Add ICE candidate from admin
      if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
      break;
      
    case 'stream-ended':
      // Admin has ended the stream
      endStream();
      
      // Show a notification to the user
      alert('Your stream has been ended by the production team.');
      
      // Reset to code screen
      streamingScreen.classList.add('hidden');
      codeScreen.classList.remove('hidden');
      break;
  }
};

// Handle connection errors
socket.onerror = (error) => {
  console.error('WebSocket error:', error);
  alert('Connection error. Please refresh the page and try again.');
};

// Handle connection closing
socket.onclose = () => {
  console.log('Disconnected from server');
  alert('Connection to server lost. Please refresh the page.');
};

// Request a code from the server
getCodeBtn.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'register-audience' }));
});

// Handle media access permission
allowMediaBtn.addEventListener('click', async () => {
  try {
    // Request access to camera and microphone
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' }, // Use front camera
      audio: true
    });
    
    // Show stream in local preview
    localVideo.srcObject = localStream;
    
    // Show streaming screen
    selectedScreen.classList.add('hidden');
    streamingScreen.classList.remove('hidden');
    
    // Set up WebRTC connection
    setupPeerConnection();
    
    // Create and send offer
    createAndSendOffer();
    
    // Notify server that stream has started
    socket.send(JSON.stringify({ type: 'stream-started' }));
    
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera or microphone. Please check permissions and try again.');
  }
});

// Set up WebRTC peer connection
function setupPeerConnection() {
  // Configure ICE servers (STUN/TURN not needed for local network, but included for robustness)
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' } // Public STUN server
    ]
  };
  
  peerConnection = new RTCPeerConnection(configuration);
  
  // Add local stream tracks to peer connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: 'ice-candidate',
        candidate: event.candidate
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
}

// Create and send WebRTC offer
async function createAndSendOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.send(JSON.stringify({
      type: 'stream-offer',
      offer: offer
    }));
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

// End the current stream
function endStream() {
  // Stop all tracks in the local stream
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localVideo.srcObject = null;
    localStream = null;
  }
  
  // Close the peer connection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
}