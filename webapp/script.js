// Dynamic WebSocket URL for production
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}/ws`);

let currentRole = null;
let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let myId = null;

let connectedViewers = new Set();
let viewerPCs = new Map(); // id -> pc
let startTime = null;
let uptimeInterval = null;

// UI toggles
function showView(id) {
    ['home-view',
        'setup-view',
        'stage'].forEach(v => document.getElementById(v).classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function toggleTheme() {
    const body = document.body;
    const current = body.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    body.setAttribute('data-theme', next);
    document.getElementById('theme-toggle').innerText = next === 'light' ? '☀️' : '🌙';
}

// Copy shareable room link
function copyRoomLink() {
    if (!currentRoomId) return;
    const url = `${location.origin}/?r=${currentRoomId}`;
    navigator.clipboard.writeText(url).then(() => {
        // Visual feedback
        const btn = event.target;
        const original = btn.innerText;
        btn.innerText = '✓';
        setTimeout(() => btn.innerText = original, 1500);
    }).catch(e => {
        prompt('Copy this link:', url);
    });
}

// Check for room code in URL and auto-join
function checkUrlForRoom() {
    const params = new URLSearchParams(location.search);
    const roomCode = params.get('r');
    if (roomCode && roomCode.length === 6) {
        // Wait for WS to connect, then auto-join
        const tryJoin = () => {
            if (ws.readyState === WebSocket.OPEN) {
                document.getElementById('room-input').value = roomCode;
                joinRoom();
                // Clean URL
                history.replaceState(null, '', location.pathname);
            } else if (ws.readyState === WebSocket.CONNECTING) {
                setTimeout(tryJoin, 100);
            }
        };
        tryJoin();
        return true;
    }
    return false;
}

function startUptime() {
    startTime = Date.now();
    if (uptimeInterval) clearInterval(uptimeInterval);

    uptimeInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');

        document.getElementById('uptime').innerText = `${h}:${m}:${s}`;
    }, 1000);
}

// --- WebSocket ---
ws.onopen = () => {
    console.log('Connected to WS');
    const cBtn = document.getElementById('btn-create');
    const jBtn = document.getElementById('btn-join');
    cBtn.disabled = false;
    cBtn.innerText = 'Create Share Room';
    jBtn.disabled = false;
    jBtn.innerText = 'Join Room';

    // Auto-join if URL has room code
    const params = new URLSearchParams(location.search);
    const roomCode = params.get('r');
    if (roomCode && roomCode.length === 6) {
        console.log('Auto-joining room:', roomCode);
        document.getElementById('room-input').value = roomCode;
        setTimeout(() => {
            joinRoom();
            history.replaceState(null, '', location.pathname);
        }, 200);
    }
};

ws.onerror = (e) => {
    console.error('WS Error', e);
    alert('WebSocket connection failed. Check console.');
};

ws.onclose = () => {
    console.warn('WS Closed');
    alert('Disconnected from server');
};

ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    switch (data.type) {
        case 'room-created':
            currentRoomId = data.roomId;
            document.getElementById('display-code').innerText = currentRoomId;
            showView('setup-view');
            break;

        case 'joined-room':
            currentRoomId = data.roomId;
            myId = data.viewerId;
            showView('stage');
            document.getElementById('viewer-waiting').classList.remove('hidden');
            break;

        case 'error':
            alert(data.message);
            break;

        case 'viewer-connect':
            handleViewerConnect(data.id);
            break;

        case 'offer':
            handleOffer(data);
            break;

        case 'answer': if (currentRole === 'broadcaster') {
            if (data.from && viewerPCs.has(data.from)) {
                const pc = viewerPCs.get(data.from);

                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                }

                catch (e) {
                    console.error('Error setting remote desc (answer):', e);
                }
            }
        }

        else if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            }

            catch (e) { }
        }

            break;

        case 'candidate': if (currentRole === 'broadcaster') {
            if (data.from && viewerPCs.has(data.from)) {
                const pc = viewerPCs.get(data.from);

                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                }

                catch (e) { }
            }
        }

        else if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }

            catch (e) { }
        }

            break;

        case 'viewer-disconnect': connectedViewers.delete(data.id);

            if (viewerPCs.has(data.id)) {
                viewerPCs.get(data.id).close();
                viewerPCs.delete(data.id);
            }

            document.getElementById('viewer-count').innerText = `Viewers: ${connectedViewers.size}`;
            break;

        case 'room-closed': alert('Broadcaster ended the session');
            window.location.reload();
            break;
    }
};

// --- Actions ---

function createRoom() {
    currentRole = 'broadcaster';

    ws.send(JSON.stringify({
        type: 'create-room'
    }));
}

function joinRoom() {
    const code = document.getElementById('room-input').value;
    if (code.length !== 6) return alert('Invalid code');

    currentRole = 'viewer';

    ws.send(JSON.stringify({
        type: 'join-room', roomId: code
    }));

    // Viewer specific UI
    document.getElementById('broadcaster-controls').classList.add('hidden');
    document.getElementById('viewer-controls').classList.remove('hidden');
}

// Global audio context for stereo processing
let audioContext = null;

// Process audio through AudioContext to ensure stereo output
async function processAudioToStereo(stream) {
    const audioTracks = stream.getAudioTracks();

    // If no audio track, return stream as-is
    if (audioTracks.length === 0) {
        console.log('No audio track to process');
        return stream;
    }

    try {
        // Create AudioContext with explicit stereo output
        audioContext = new AudioContext({ sampleRate: 48000 });

        // Create source from stream
        const source = audioContext.createMediaStreamSource(stream);

        // Create a stereo destination
        const destination = audioContext.createMediaStreamDestination();
        destination.channelCount = 2;
        destination.channelCountMode = 'explicit';

        // Create a channel splitter and merger to force stereo
        const audioTrack = audioTracks[0];
        const settings = audioTrack.getSettings();
        const inputChannels = settings.channelCount || 1;

        console.log(`Audio input channels: ${inputChannels}`);

        if (inputChannels === 1) {
            // Mono input: duplicate to both L and R channels
            const splitter = audioContext.createChannelSplitter(1);
            const merger = audioContext.createChannelMerger(2);

            source.connect(splitter);
            splitter.connect(merger, 0, 0); // Mono to Left
            splitter.connect(merger, 0, 1); // Mono to Right
            merger.connect(destination);

            console.log('Converted mono to stereo');
        } else {
            // Already stereo or more, just pass through
            source.connect(destination);
            console.log('Audio already stereo, passing through');
        }

        // Create new stream with video from original + processed audio
        const processedStream = new MediaStream();

        // Add video tracks from original stream
        stream.getVideoTracks().forEach(track => {
            processedStream.addTrack(track);
        });

        // Add processed stereo audio track
        destination.stream.getAudioTracks().forEach(track => {
            processedStream.addTrack(track);
        });

        console.log('Stereo audio processing enabled');
        return processedStream;

    } catch (e) {
        console.error('Stereo processing failed, using original:', e);
        return stream;
    }
}

async function startBroadcasting() {
    const resLimit = document.getElementById('res-limit').value;

    let videoConstraints = {
        frameRate: 60
    };

    if (resLimit === '1080') {
        videoConstraints.height = {
            ideal: 1080
        };
    }

    else if (resLimit === '720') {
        videoConstraints.height = {
            ideal: 720
        };
    }

    try {
        const rawStream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: 48000
            }
        });

        // Process audio to ensure stereo
        localStream = await processAudioToStereo(rawStream);

        // Switch UI
        showView('stage');

        // Show Info Bar & Controls
        document.getElementById('info-bar').classList.remove('hidden');
        document.getElementById('info-bar').style.position = 'absolute';
        document.getElementById('info-bar').style.top = '20px';
        document.getElementById('stage-room-code').innerText = 'Code: ' + currentRoomId;
        document.getElementById('broadcaster-controls').classList.remove('hidden');

        // Setup local preview
        document.getElementById('main-video').srcObject = localStream;
        document.getElementById('main-video').muted = true;
        document.getElementById('main-video').play();

        startUptime();

        // Process queued viewers
        connectedViewers.forEach(id => {
            initiateConnection(id);
        });

        // Track stopped?
        localStream.getVideoTracks()[0].onended = () => {
            alert('Sharing stopped');
            window.location.reload();
        };

    }

    catch (e) {
        console.error(e);
    }
}

// Change screen while broadcasting
async function changeScreen() {
    try {
        const resLimit = document.getElementById('res-limit').value;
        let videoConstraints = { frameRate: 60 };
        if (resLimit === '1080') videoConstraints.height = { ideal: 1080 };
        else if (resLimit === '720') videoConstraints.height = { ideal: 720 };

        // Stop old tracks
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
        }

        // Close old audio context
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        // Get new screen
        const rawStream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: 48000
            }
        });

        // Process audio to ensure stereo
        localStream = await processAudioToStereo(rawStream);

        // Update local preview
        document.getElementById('main-video').srcObject = localStream;

        // Replace tracks in all peer connections
        const newVideoTrack = localStream.getVideoTracks()[0];
        const newAudioTrack = localStream.getAudioTracks()[0];

        for (const pc of viewerPCs.values()) {
            const senders = pc.getSenders();
            for (const sender of senders) {
                if (sender.track?.kind === 'video' && newVideoTrack) {
                    await sender.replaceTrack(newVideoTrack);
                } else if (sender.track?.kind === 'audio' && newAudioTrack) {
                    await sender.replaceTrack(newAudioTrack);
                }
            }
        }

        // Track ended event
        newVideoTrack.onended = () => {
            alert('Sharing stopped');
            window.location.reload();
        };

        console.log('Screen changed successfully');
    } catch (e) {
        console.error('Failed to change screen:', e);
    }
}

// --- WebRTC Logic ---

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [{
            urls: 'stun:stun.l.google.com:19302'
        }

        ]
    });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                to: targetId, // For broadcaster -> viewer logic
                from: myId, // For viewer -> broadcaster logic
                roomId: currentRoomId
            }));
        }
    };

    return pc;
}

// SDP Munging for high-quality stereo Opus audio
function upgradeAudioQuality(sdp) {
    // Find Opus payload type
    const opusMatch = sdp.match(/a=rtpmap:(\d+) opus/);
    if (!opusMatch) return sdp;
    const opusPayload = opusMatch[1];

    // Replace or add fmtp line for Opus with stereo and high bitrate
    const fmtpRegex = new RegExp(`a=fmtp:${opusPayload} (.*)`, 'g');
    if (sdp.match(fmtpRegex)) {
        // Modify existing fmtp line
        sdp = sdp.replace(fmtpRegex, (match, params) => {
            // Remove any existing stereo/bitrate params and add our own
            let newParams = params.replace(/;?stereo=\d/g, '')
                .replace(/;?sprop-stereo=\d/g, '')
                .replace(/;?maxaveragebitrate=\d+/g, '')
                .replace(/;?cbr=\d/g, '');
            return `a=fmtp:${opusPayload} ${newParams};stereo=1;sprop-stereo=1;maxaveragebitrate=510000;cbr=1`;
        });
    } else {
        // Add fmtp line after rtpmap
        sdp = sdp.replace(
            new RegExp(`(a=rtpmap:${opusPayload} opus[^\n]*)`),
            `$1\na=fmtp:${opusPayload} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=510000;cbr=1`
        );
    }
    return sdp;
}

async function handleViewerConnect(viewerId) {
    console.log('Viewer joined:', viewerId);
    connectedViewers.add(viewerId);

    document.getElementById('viewer-count').innerText = `Viewers: ${connectedViewers.size}`;

    if (localStream) {
        initiateConnection(viewerId);
    }
}

async function initiateConnection(viewerId) {
    if (viewerPCs.has(viewerId)) return; // Already connecting/connected

    const pc = createPeerConnection(viewerId);
    viewerPCs.set(viewerId, pc);

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    // Apply default bitrates from selects (20Mbps video, 320kbps audio)
    const videoBitrate = parseInt(document.getElementById('video-bitrate-select').value) * 1000000;
    const audioBitrate = parseInt(document.getElementById('audio-bitrate-select').value) * 1000;
    updateBitrateForPC(pc, videoBitrate);
    updateAudioBitrateForPC(pc, audioBitrate);

    const offer = await pc.createOffer();
    // Apply SDP munging for high-quality audio
    offer.sdp = upgradeAudioQuality(offer.sdp);
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'offer',
        sdp: offer,
        to: viewerId,
        roomId: currentRoomId
    }));
}

// Viewer side logic
async function handleOffer(data) {
    document.getElementById('viewer-waiting').classList.add('hidden');

    peerConnection = createPeerConnection(null);

    peerConnection.ontrack = (event) => {
        const video = document.getElementById('main-video');
        video.srcObject = event.streams[0];

        // Safari fix: Start muted for autoplay, then unmute
        video.muted = true;

        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Autoplay worked, try to unmute after a short delay
                setTimeout(() => {
                    video.muted = false;
                }, 100);
            }).catch(err => {
                console.log('Autoplay blocked, showing play button:', err);
                showPlayButton();
            });
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    ws.send(JSON.stringify({
        type: 'answer',
        sdp: answer,
        roomId: currentRoomId,
        from: myId // IMPORTANT: Send my ID so broadcaster knows who answered
    }));
}

// Show play button for Safari/browsers that block autoplay
function showPlayButton() {
    // Remove existing play button if any
    let existingBtn = document.getElementById('safari-play-btn');
    if (existingBtn) existingBtn.remove();

    const playBtn = document.createElement('button');
    playBtn.id = 'safari-play-btn';
    playBtn.className = 'btn';
    playBtn.innerHTML = '▶ Tap to Play';
    playBtn.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
        padding: 20px 40px;
        font-size: 1.5rem;
        background: var(--primary);
        border: none;
        border-radius: 12px;
        cursor: pointer;
        animation: pulse 1.5s infinite;
    `;

    playBtn.onclick = () => {
        const video = document.getElementById('main-video');
        video.muted = false;
        video.play().then(() => {
            playBtn.remove();
        }).catch(e => {
            console.error('Play failed:', e);
            // Try playing muted as last resort
            video.muted = true;
            video.play();
            playBtn.remove();
        });
    };

    document.getElementById('stage').appendChild(playBtn);
}

// --- Advanced Controls & Logic ---

let zoomLevel = 1;
let statsInterval = null;
let videoEl = document.getElementById('main-video');

// Initial setup
videoEl.onvolumechange = () => {
    const btn = document.getElementById('mute-btn');
    btn.innerText = videoEl.muted || videoEl.volume === 0 ? '🔇' : '🔊';
};

function stopSharing() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        alert('Sharing stopped');
        window.location.reload();
    }
}

// --- Video Bitrate ---
function updateVideoBitrate(mbps) {
    const bps = parseInt(mbps) * 1000000;
    for (const pc of viewerPCs.values()) {
        updateBitrateForPC(pc, bps);
    }
}

// --- Audio Bitrate ---
function updateAudioBitrateSelect(kbps) {
    const bps = parseInt(kbps) * 1000;
    for (const pc of viewerPCs.values()) {
        updateAudioBitrateForPC(pc, bps);
    }
}

async function updateAudioBitrateForPC(pc, bps) {
    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track?.kind === 'audio');
    if (audioSender) {
        const params = audioSender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = bps;
        try { await audioSender.setParameters(params); } catch (e) { console.error(e); }
    }
}

// --- Fullscreen ---
function toggleFullscreen() {
    const stage = document.getElementById('stage');
    if (!document.fullscreenElement) {
        if (stage.requestFullscreen) {
            stage.requestFullscreen();
        } else if (stage.webkitRequestFullscreen) {
            stage.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

// --- Zoom ---
function zoomIn() {
    zoomLevel += 0.25;
    applyZoom();
}
function zoomOut() {
    zoomLevel = Math.max(0.5, zoomLevel - 0.25);
    applyZoom();
}
function resetZoom() {
    zoomLevel = 1;
    // content should fit screen by default via CSS object-fit: contain
    applyZoom();
}
function applyZoom() {
    // Ensure we default to contain when at scale 1 to 'fit' perfectly
    if (zoomLevel === 1) {
        videoEl.style.objectFit = 'contain';
        videoEl.style.transform = 'none';
    } else {
        // When zooming in, we might want to allow it to cover/expand
        // But keeping 'contain' with scale works best for simple zoom
        videoEl.style.transform = `scale(${zoomLevel})`;
    }
}

// --- Audio ---
function toggleMute() {
    videoEl.muted = !videoEl.muted;
}
function setVolume(val) {
    videoEl.volume = val;
    videoEl.muted = (val === 0);
}

// --- Stats ---
function toggleStats() {
    const el = document.getElementById('stats-overlay');
    if (el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        startStatsLoop();
    } else {
        el.classList.add('hidden');
        if (statsInterval) clearInterval(statsInterval);
    }
}

function startStatsLoop() {
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(async () => {
        let pc = null;
        if (currentRole === 'viewer') pc = peerConnection;
        else if (connectedViewers.size > 0) {
            // Pick first viewer for stats
            const firstId = connectedViewers.values().next().value;
            pc = viewerPCs.get(firstId);
        }

        if (!pc) return;

        const stats = await pc.getStats();
        stats.forEach(report => {
            // Viewer Inbound Video
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                document.getElementById('stat-res').innerText = (report.frameWidth || '-') + 'x' + (report.frameHeight || '-');
                document.getElementById('stat-fps').innerText = report.framesPerSecond || '-';
                // Bitrate calc requires storing prev bytes. Simplifying for now to simple snapshot if available, 
                // or just showing packetsLost
                document.getElementById('stat-loss').innerText = report.packetsLost || 0;

                // Bitrate estimation (rough)
                // We need state to calc bitrate. 
            }
            // Broadcaster Outbound Video
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                document.getElementById('stat-res').innerText = (report.frameWidth || '-') + 'x' + (report.frameHeight || '-');
                document.getElementById('stat-fps').innerText = report.framesPerSecond || '-';
            }
        });

        // For real bitrate we need delta, leaving simple for now to avoid complexity in this step
        // Ideally we use report.bytesReceived - prevBytes / time
    }, 1000);
}

// --- UI Interactions ---
// (Handled in setupUIInteractions below)

// --- Existing helpers ---
let contentHintMode = 'motion';
// Feature Detection
function checkFeatureSupport() {
    // Check if contentHint is supported in MediaStreamTrack prototype
    // Note: Some browsers implement it but it might not be in the prototype specifically on older versions,
    // but checking 'contentHint' in MediaStreamTrack.prototype is standard.
    // Also checking if we are in a secure context which is required for many media features.

    const isSupported = 'contentHint' in MediaStreamTrack.prototype;

    if (isSupported) {
        document.getElementById('content-hint-container').classList.remove('hidden');
        document.getElementById('overlay-content-hint').classList.remove('hidden');
    } else {
        console.log("Browser does not support contentHint");
    }
}

// UI Interaction Logic (Auto-hide & Toggle)
let uiTimeout;
const UI_IDLE_TIME = 4000;

function setupUIInteractions() {
    const stage = document.getElementById('stage');
    const controls = document.getElementById('controls-overlay');
    const infoBar = document.getElementById('info-bar');

    function showUI() {
        controls.classList.remove('hidden-ui');
        infoBar.classList.remove('hidden-ui');
        resetIdleTimer();
    }

    function hideUI() {
        // Broadcaster: Never auto-hide, always keep controls visible
        if (currentRole === 'broadcaster') return;

        controls.classList.add('hidden-ui');
        infoBar.classList.add('hidden-ui');
    }

    function toggleUI() {
        // Broadcaster: Don't toggle, always show
        if (currentRole === 'broadcaster') return;

        if (controls.classList.contains('hidden-ui')) {
            showUI();
        } else {
            hideUI();
        }
    }

    function resetIdleTimer() {
        // Broadcaster: No timer needed
        if (currentRole === 'broadcaster') return;

        clearTimeout(uiTimeout);
        uiTimeout = setTimeout(hideUI, UI_IDLE_TIME);
    }

    // Tap anywhere on stage to toggle (viewer only)
    // Use both stage and video element for Safari Mac compatibility
    const handleStageClick = (e) => {
        // Ignore clicks on actual controls
        if (e.target.closest('#controls-overlay') || e.target.closest('.info-pill') ||
            e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
            resetIdleTimer();
            return;
        }
        toggleUI();
    };

    stage.addEventListener('click', handleStageClick);

    // Safari Mac fix: video element can consume clicks, so attach handler to video too
    const videoEl = document.getElementById('main-video');
    videoEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent double trigger
        toggleUI();
    });

    // Any interaction resets timer (viewer only)
    ['mousemove', 'touchstart', 'click', 'input'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (!controls.classList.contains('hidden-ui')) {
                resetIdleTimer();
            }
        });
    });

    // Initial start - only for viewer
    if (currentRole !== 'broadcaster') {
        resetIdleTimer();
    }
}

// Call on load
document.addEventListener('DOMContentLoaded', () => {
    checkFeatureSupport();
    setupUIInteractions();
});

function applyContentHint(mode) {
    // Sync both selects
    document.getElementById('content-hint-select').value = mode;
    document.getElementById('overlay-hint-select').value = mode;

    // Apply to current stream if exists
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && 'contentHint' in videoTrack) {
            videoTrack.contentHint = mode;
            console.log(`Content hint set to: ${mode}`);

            // Show feedback
            const btn = document.activeElement;
            if (btn && btn.tagName === "SELECT") {
                const originalColor = btn.style.borderColor;
                btn.style.borderColor = "var(--success)";
                setTimeout(() => btn.style.borderColor = originalColor, 500);
            }
        }
    }
}

// Old setHint wrapper for compatibility if needed (deprecated)
function setHint(mode) {
    applyContentHint(mode);
}

// Legacy function kept for compatibility
async function updateBitrate(mbps) {
    updateVideoBitrate(mbps);
}

async function updateBitrateForPC(pc, bps) {
    const senders = pc.getSenders();
    const sender = senders.find(s => s.track.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate = bps;
    try { await sender.setParameters(params); } catch (e) { }
}
