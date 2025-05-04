// Connect to WebSocket server
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
const socket = new WebSocket(wsUrl);

// DOM elements
const connectionStatus = document.getElementById('connection-status');
const audienceCount = document.getElementById('audience-count');
const audienceList = document.getElementById('audience-list');
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
      
      // Initialize audience list if provided
      if (data.audienceList) {
        updateAudienceList(data.audienceList);
      }
      break;
      
    case 'audience-updated':
      // Update the audience list UI
      if (data.audienceList) {
        updateAudienceList(data.audienceList);
        audienceCount.textContent = `${data.audienceList.length} audience members connected`;
      }
      break;
      
    case 'audience-found':
      selectionStatus.textContent = `Audience member with code ${data.code} selected. Waiting for them to accept...`;
      selectionStatus.classList.add('success');
      currentCode = data.code;
      
      // Highlight the selected audience item
      highlightSelectedAudience(data.code);
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
      
      // Update the streaming status in the audience list
      updateStreamingStatus(data.code, true);
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

// Update the audience list in the UI
function updateAudienceList(audienceMembers) {
  // Clear existing list
  audienceList.innerHTML = '';
  
  if (audienceMembers.length === 0) {
    audienceList.innerHTML = '<p class="empty-list-message">No audience members connected yet</p>';
    return;
  }
  
  // Sort audience members by code
  audienceMembers.sort((a, b) => a.code.localeCompare(b.code));
  
  // Create a list item for each audience member
  audienceMembers.forEach(member => {
    const audienceItem = document.createElement('div');
    audienceItem.className = 'audience-item';
    audienceItem.dataset.code = member.code;
    
    if (member.code === currentCode) {
      audienceItem.classList.add('selected');
    }
    
    if (member.streaming) {
      audienceItem.classList.add('streaming');
    }
    
    audienceItem.innerHTML = `
      <span class="audience-code">${member.code}</span>
      <span class="audience-status ${member.streaming ? 'streaming' : ''}">${member.streaming ? 'Streaming' : 'Ready'}</span>
    `;
    
    // Add click handler to select this audience member
    audienceItem.addEventListener('click', () => {
      codeInput.value = member.code;
      selectBtn.click();
    });
    
    audienceList.appendChild(audienceItem);
  });
}

// Highlight the selected audience item
function highlightSelectedAudience(code) {
  // Remove 'selected' class from all items
  const items = audienceList.querySelectorAll('.audience-item');
  items.forEach(item => item.classList.remove('selected'));
  
  // Add 'selected' class to the matching item
  const selectedItem = audienceList.querySelector(`.audience-item[data-code="${code}"]`);
  if (selectedItem) {
    selectedItem.classList.add('selected');
    // Scroll to the selected item
    selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Update the streaming status of an audience member
function updateStreamingStatus(code, isStreaming) {
  const item = audienceList.querySelector(`.audience-item[data-code="${code}"]`);
  if (item) {
    const statusSpan = item.querySelector('.audience-status');
    
    if (isStreaming) {
      item.classList.add('streaming');
      statusSpan.classList.add('streaming');
      statusSpan.textContent = 'Streaming';
    } else {
      item.classList.remove('streaming');
      statusSpan.classList.remove('streaming');
      statusSpan.textContent = 'Ready';
    }
  }
}

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
  // Get all available audience codes from the UI
  const audienceItems = audienceList.querySelectorAll('.audience-item:not(.streaming)');
  
  if (audienceItems.length === 0) {
    selectionStatus.textContent = 'No available audience members to select';
    selectionStatus.classList.add('error');
    return;
  }
  
  // Select a random audience item
  const randomIndex = Math.floor(Math.random() * audienceItems.length);
  const randomCode = audienceItems[randomIndex].dataset.code;
  
  // Set the input value and trigger selection
  codeInput.value = randomCode;
  selectBtn.click();
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
  
  // Update UI to reflect stream ending
  if (currentCode) {
    updateStreamingStatus(currentCode, false);
    currentCode = null;
  }
  
  selectionStatus.textContent = 'Stream ended';
}