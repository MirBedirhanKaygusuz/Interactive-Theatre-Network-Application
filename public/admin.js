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
const randomRaisedHandBtn = document.getElementById('random-raised-hand-btn');
const selectionStatus = document.getElementById('selection-status');
const remoteVideo = document.getElementById('remote-video');
const noStreamMessage = document.getElementById('no-stream-message');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const endStreamBtn = document.getElementById('end-stream-btn');

// Question management elements
const askQuestionBtn = document.getElementById('ask-question-btn');
const closeQuestionBtn = document.getElementById('close-question-btn');
const currentQuestionDisplay = document.getElementById('current-question-display');
const currentQuestionText = document.getElementById('current-question-text');

// Filter controls
const showAllBtn = document.getElementById('show-all-btn');
const showRaisedHandsBtn = document.getElementById('show-raised-hands-btn');

// WebRTC variables
let peerConnection;
let currentCode = null;
let isStreamActive = false;

// Question variables
let isQuestionOpen = false;

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
  console.log('Sunucudan mesaj alındı:', data);
  
  switch(data.type) {
    case 'admin-registered':
      console.log('Admin kaydı onaylandı');
      audienceCount.textContent = `${data.activeAudience} audience members connected`;
      
      // Initialize audience list if provided
      if (data.audienceList) {
        updateAudienceList(data.audienceList);
      }
      
      // Set initial stream state
      if (data.isStreamActive && data.currentStreamingCode) {
        isStreamActive = true;
        currentCode = data.currentStreamingCode;
        updateStreamControlsState(true);
        updateSelectionControls();
        selectionStatus.textContent = `Stream active for code ${currentCode}`;
        noStreamMessage.style.display = 'none';
      }
      
      // Set initial question state
      if (data.isQuestionOpen) {
        console.log('Sunucu başlangıçta bir soru açık olduğunu bildirdi');
        isQuestionOpen = true;
        updateQuestionUI(true);
      }
      break;
      
    case 'audience-updated':
      console.log('İzleyici listesi güncellendi');
      // Update the audience list UI
      if (data.audienceList) {
        updateAudienceList(data.audienceList);
        audienceCount.textContent = `${data.audienceList.length} audience members connected`;
      }
      
      // Update stream state if provided
      if (data.hasOwnProperty('isStreamActive')) {
        isStreamActive = data.isStreamActive;
        updateSelectionControls();
        
        if (data.currentStreamingCode) {
          currentCode = data.currentStreamingCode;
        }
      }
      
      // Update question state if provided
      if (data.hasOwnProperty('isQuestionOpen')) {
        console.log('Sunucu soru durumu güncelledi:', data.isQuestionOpen);
        isQuestionOpen = data.isQuestionOpen;
        updateQuestionUI(isQuestionOpen);
      }
      break;
      
    case 'selection-rejected':
      selectionStatus.textContent = data.reason;
      selectionStatus.classList.add('error');
      
      if (currentCode) {
        highlightSelectedAudience(currentCode);
      }
      break;
      
    case 'audience-found':
      selectionStatus.textContent = `Audience member with code ${data.code} selected. Waiting for them to accept...`;
      selectionStatus.classList.add('success');
      currentCode = data.code;
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
      
      isStreamActive = true;
      updateStreamControlsState(true);
      updateSelectionControls();
      
      updateStreamingStatus(data.code, true);
      break;
      
    case 'stream-ended':
      selectionStatus.textContent = `Stream ended for code ${data.code}`;
      noStreamMessage.style.display = 'block';
      
      noStreamMessage.classList.add('fade-in');
      setTimeout(() => {
        noStreamMessage.classList.remove('fade-in');
      }, 1000);
      
      isStreamActive = false;
      updateStreamControlsState(false);
      updateSelectionControls();
      
      if (data.code) {
        updateStreamingStatus(data.code, false);
      }
      
      if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
      }
      
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      
      currentCode = null;
      break;
      
    case 'stream-offer':
      handleStreamOffer(data.offer, data.code);
      break;
      
    case 'ice-candidate':
      if (peerConnection && data.code === currentCode) {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
      break;
      
    case 'audience-disconnected':
      if (data.code === currentCode) {
        selectionStatus.textContent = `Audience member with code ${data.code} disconnected`;
        selectionStatus.classList.add('error');
        
        if (isStreamActive) {
          isStreamActive = false;
          updateStreamControlsState(false);
          updateSelectionControls();
          
          if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
          }
          
          if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
          }
          
          noStreamMessage.style.display = 'block';
          currentCode = null;
        }
      }
      break;
  }
};

// Kontrol düğmelerinin durumunu güncelleme
function updateSelectionControls() {
  // Eğer soru açık ve yayın yoksa seçimleri etkinleştir
  const enableControls = isQuestionOpen && !isStreamActive;
  
  // El kaldıranlardan seç düğmesi sadece soru açıksa aktif
  randomRaisedHandBtn.disabled = !isQuestionOpen || isStreamActive;
  
  // Kod girişi ve seç düğmesi sadece soru açık ve yayın yoksa aktif
  selectBtn.disabled = !enableControls;
  codeInput.disabled = !enableControls;
}

// Update the audience list in the UI
function updateAudienceList(audienceMembers) {
  // Clear existing list
  audienceList.innerHTML = '';
  
  if (audienceMembers.length === 0) {
    audienceList.innerHTML = '<p class="empty-list-message">No audience members connected yet</p>';
    return;
  }
  
  // Filter audience members based on current filter
  let filteredMembers = audienceMembers;
  if (showRaisedHandsBtn.classList.contains('active')) {
    filteredMembers = audienceMembers.filter(member => member.handRaised);
    
    // If there are no members after filtering
    if (filteredMembers.length === 0) {
      audienceList.innerHTML = '<p class="empty-list-message">No audience members with raised hands</p>';
      return;
    }
  }
  
  // Sort audience members by seat number (if available) or code
  filteredMembers.sort((a, b) => {
    // First try to sort by seat number
    if (a.seatNumber && a.seatNumber !== 'Unknown' && 
        b.seatNumber && b.seatNumber !== 'Unknown') {
      return a.seatNumber.localeCompare(b.seatNumber);
    }
    // Fall back to sorting by code
    return a.code.localeCompare(b.code);
  });
  
  // Create a list item for each audience member
  filteredMembers.forEach(member => {
    const audienceItem = document.createElement('div');
    audienceItem.className = 'audience-item';
    audienceItem.dataset.code = member.code;
    
    if (member.code === currentCode) {
      audienceItem.classList.add('selected');
    }
    
    if (member.streaming) {
      audienceItem.classList.add('streaming');
    }
    
    if (member.handRaised) {
      audienceItem.classList.add('hand-raised');
    }
    
    // iOS app için ek sınıf
    if (member.deviceType === 'ios') {
      audienceItem.classList.add('ios-device');
    }
    
    // Make sure seatNumber has a valid value
    const seatNumber = member.seatNumber || 'Unknown';
    
    audienceItem.innerHTML = `
      <span class="audience-code">${member.code}</span>
      <div class="audience-right">
        <span class="audience-seat">Seat: ${seatNumber}</span>
        <div class="audience-status-container">
          <span class="audience-status ${member.streaming ? 'streaming' : ''}">${member.streaming ? 'Streaming' : 'Ready'}</span>
          ${member.handRaised ? '<span class="hand-indicator">✋</span>' : ''}
          ${member.deviceType === 'ios' ? '<span class="device-indicator">📱</span>' : '<span class="device-indicator">🖥️</span>'}
        </div>
      </div>
    `;
    
    // Add click handler to select this audience member
    audienceItem.addEventListener('click', () => {
      // Sadece soru açıksa ve bu izleyici el kaldırdıysa seçmeye izin ver
      if (!isQuestionOpen) {
        selectionStatus.textContent = 'Lütfen önce bir soru açın';
        selectionStatus.classList.add('error');
        setTimeout(() => {
          selectionStatus.textContent = '';
          selectionStatus.classList.remove('error');
        }, 3000);
        return;
      }
      
      // Yayın aktifse ve bu izleyici değilse, seçime izin verme
      if (isStreamActive && member.code !== currentCode) {
        selectionStatus.textContent = 'Lütfen önce aktif yayını sonlandırın';
        selectionStatus.classList.add('error');
        setTimeout(() => {
          selectionStatus.textContent = '';
          selectionStatus.classList.remove('error');
        }, 3000);
        return;
      }
      
      // El kaldırmayan izleyiciyi seçmeye izin verme
      if (!member.handRaised && !member.streaming) {
        selectionStatus.textContent = 'Sadece el kaldıran izleyicileri seçebilirsiniz';
        selectionStatus.classList.add('error');
        setTimeout(() => {
          selectionStatus.textContent = '';
          selectionStatus.classList.remove('error');
        }, 3000);
        return;
      }
      
      codeInput.value = member.code;
      selectBtn.click();
    });
    
    audienceList.appendChild(audienceItem);
  });
}

// Update the state of stream controls
function updateStreamControlsState(enabled) {
  endStreamBtn.disabled = !enabled;
  fullscreenBtn.disabled = !enabled;
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

// Update the question UI
function updateQuestionUI(isOpen) {
  if (isOpen) {
    currentQuestionDisplay.classList.remove('hidden');
    currentQuestionText.textContent = 'Soru açık';
    currentQuestionText.style.color = '#2ecc71';
    
    askQuestionBtn.disabled = true;
    closeQuestionBtn.disabled = false;
  } else {
    currentQuestionDisplay.classList.remove('hidden');
    currentQuestionText.textContent = 'Soru kapalı';
    currentQuestionText.style.color = '#e74c3c';
    
    askQuestionBtn.disabled = false;
    closeQuestionBtn.disabled = true;
  }
  
  // Seçim kontrollerini güncelle
  updateSelectionControls();
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
  // Soru kapalıysa seçime izin verme
  if (!isQuestionOpen) {
    selectionStatus.textContent = 'Lütfen önce bir soru açın';
    selectionStatus.classList.add('error');
    setTimeout(() => {
      selectionStatus.textContent = '';
      selectionStatus.classList.remove('error');
    }, 3000);
    return;
  }
  
  // Yayın aktifse başka izleyici seçme
  if (isStreamActive && codeInput.value.toUpperCase() !== currentCode) {
    selectionStatus.textContent = 'Lütfen önce aktif yayını sonlandırın';
    selectionStatus.classList.add('error');
    setTimeout(() => {
      selectionStatus.textContent = '';
      selectionStatus.classList.remove('error');
    }, 3000);
    return;
  }
  
  const code = codeInput.value.toUpperCase();
  if (code.length === 4) {
    // El kaldırmış mı kontrol et
    const audienceItem = audienceList.querySelector(`.audience-item[data-code="${code}"]`);
    if (audienceItem && !audienceItem.classList.contains('hand-raised') && !audienceItem.classList.contains('streaming')) {
      selectionStatus.textContent = 'Sadece el kaldıran izleyicileri seçebilirsiniz';
      selectionStatus.classList.add('error');
      setTimeout(() => {
        selectionStatus.textContent = '';
        selectionStatus.classList.remove('error');
      }, 3000);
      return;
    }
    
    socket.send(JSON.stringify({
      type: 'select-code',
      code: code
    }));
    selectionStatus.textContent = `Selecting code ${code}...`;
    selectionStatus.classList.remove('error', 'success');
  } else {
    selectionStatus.textContent = 'Lütfen geçerli bir 4 karakterlik kod girin';
    selectionStatus.classList.add('error');
  }
});

// Question management handlers
askQuestionBtn.addEventListener('click', () => {
  console.log('Soru Aç butonuna tıklandı');
  
  // WebSocket bağlantısını kontrol et
  if (socket.readyState !== WebSocket.OPEN) {
    console.error('WebSocket bağlantısı açık değil. Durum:', socket.readyState);
    alert('Sunucu bağlantısı kurulamadı. Lütfen sayfayı yenileyin ve tekrar deneyin.');
    return;
  }
  
  try {
    // Send request to open the question to the server
    socket.send(JSON.stringify({
      type: 'open-question',
      question: 'Yeni Soru' // Default değer
    }));
    
    console.log('Soru açma isteği gönderildi');
    
    // Update local state
    isQuestionOpen = true;
    updateQuestionUI(true);
  } catch (error) {
    console.error('Soru açma hatası:', error);
    alert('Soru açılırken bir hata oluştu. Lütfen tekrar deneyin.');
  }
});

closeQuestionBtn.addEventListener('click', () => {
  // Send close question request to server
  socket.send(JSON.stringify({
    type: 'close-question'
  }));
  
  // Update local state
  isQuestionOpen = false;
  updateQuestionUI(false);
});

// Filter buttons handlers
showAllBtn.addEventListener('click', () => {
  showAllBtn.classList.add('active');
  showRaisedHandsBtn.classList.remove('active');
  // Re-render the audience list
  socket.send(JSON.stringify({ type: 'get-audience-list' }));
});

showRaisedHandsBtn.addEventListener('click', () => {
  showAllBtn.classList.remove('active');
  showRaisedHandsBtn.classList.add('active');
  // Re-render the audience list
  socket.send(JSON.stringify({ type: 'get-audience-list' }));
});

// Random raised hand selection
randomRaisedHandBtn.addEventListener('click', () => {
  // Soru kapalıysa seçime izin verme
  if (!isQuestionOpen) {
    selectionStatus.textContent = 'Lütfen önce bir soru açın';
    selectionStatus.classList.add('error');
    setTimeout(() => {
      selectionStatus.textContent = '';
      selectionStatus.classList.remove('error');
    }, 3000);
    return;
  }
  
  // Yayın aktifse seçime izin verme
  if (isStreamActive) {
    selectionStatus.textContent = 'Lütfen önce aktif yayını sonlandırın';
    selectionStatus.classList.add('error');
    setTimeout(() => {
      selectionStatus.textContent = '';
      selectionStatus.classList.remove('error');
    }, 3000);
    return;
  }
  
  // Get all audience items with raised hands
  const raisedHandItems = audienceList.querySelectorAll('.audience-item.hand-raised:not(.streaming)');
  
  if (raisedHandItems.length === 0) {
    selectionStatus.textContent = 'El kaldıran izleyici yok';
    selectionStatus.classList.add('error');
    return;
  }
  
  // Select a random audience item
  const randomIndex = Math.floor(Math.random() * raisedHandItems.length);
  const randomCode = raisedHandItems[randomIndex].dataset.code;
  
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
  
  // Notify the server that the stream has ended
  socket.send(JSON.stringify({
    type: 'end-stream',
    code: currentCode
  }));
  
  // Update UI locally"
  noStreamMessage.style.display = 'block';
  updateStreamControlsState(false);
}

// Server a get-audience-list isteği eklemek için handler ekle
socket.addEventListener('open', () => {
  console.log('WebSocket bağlantısı açıldı');
});