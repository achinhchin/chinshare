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

let broadcastSource = 'screen'; // 'screen' or 'file'
let fileVideoEl = document.createElement('video');
fileVideoEl.muted = true;
fileVideoEl.playsInline = true;
fileVideoEl.loop = true;
let fileCanvas = document.createElement('canvas');
let fileCtx = fileCanvas.getContext('2d');
let fileDrawInterval = null;
let fileAspectRatio = 'original';
let fileScaleMode = 'contain';

function updateScaleMode(mode) {
    fileScaleMode = mode;
}

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

// --- File / Source Logic ---
function setSource(source) {
    broadcastSource = source;
    document.querySelectorAll('.source-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-source-${source}`).classList.add('active');

    if (source === 'file') {
        document.getElementById('file-setup').classList.remove('hidden');
        document.getElementById('content-hint-container').classList.add('hidden');
    } else {
        document.getElementById('file-setup').classList.add('hidden');
        document.getElementById('content-hint-container').classList.remove('hidden');
    }
}

function handleFileSelect(input) {
    const file = input.files[0];
    if (file) {
        document.getElementById('file-name-display').innerText = file.name;
        const url = URL.createObjectURL(file);
        fileVideoEl.src = url;
    }
}

function updateAspectRatio(ratio) {
    fileAspectRatio = ratio;
}

// File Controls UI
let playPromise = undefined;

function toggleFilePlayback() {
    if (!fileVideoEl) return;

    if (fileVideoEl.paused || fileVideoEl.ended) {
        playPromise = fileVideoEl.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.error('Play error:', e);
            });
        }
    } else {
        // If play is pending, we shouldn't pause yet or we get an error. 
        // But for simplicity in this UI, we just try to pause.
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                fileVideoEl.pause();
            })
                .catch(error => {
                    // Auto-play was prevented.
                });
        } else {
            fileVideoEl.pause();
        }
    }
    // UI update will happen in updateFileControls loop
}

function onSeek(val) {
    const time = (val / 100) * fileVideoEl.duration;
    if (Number.isFinite(time)) {
        fileVideoEl.currentTime = time;
    }
}

function updateFileControls() {
    if (!fileVideoEl.paused && !fileVideoEl.ended) {
        document.getElementById('btn-play-pause').innerText = '⏸';
    } else {
        document.getElementById('btn-play-pause').innerText = '▶';
    }

    const progress = (fileVideoEl.currentTime / fileVideoEl.duration) * 100 || 0;
    document.getElementById('file-timeline').value = progress;

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    document.getElementById('file-time-current').innerText = formatTime(fileVideoEl.currentTime || 0);
    document.getElementById('file-time-total').innerText = formatTime(fileVideoEl.duration || 0);

    requestAnimationFrame(updateFileControls);
}

// Add click listener to drop area
document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('file-drop-area');
    if (dropArea) {
        dropArea.onclick = () => document.getElementById('file-input').click();
    }
});

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
    try {
        if (broadcastSource === 'screen') {
            // --- Screen Sharing Logic (Existing) ---
            const resLimit = document.getElementById('res-limit').value;
            let videoConstraints = { frameRate: 60 };
            if (resLimit === '1080') videoConstraints.height = { ideal: 1080 };
            else if (resLimit === '720') videoConstraints.height = { ideal: 720 };

            const forceStereo = document.getElementById('force-stereo').checked;
            let audioConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                sampleRate: 48000
            };

            if (forceStereo) {
                audioConstraints = {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    googEchoCancellation: false,
                    googAutoGainControl: false,
                    googNoiseSuppression: false,
                    googHighpassFilter: false,
                    channelCount: { ideal: 2, min: 2 },
                    sampleRate: 48000
                };
            }

            let rawStream;
            try {
                rawStream = await navigator.mediaDevices.getDisplayMedia({
                    video: videoConstraints,
                    audio: audioConstraints
                });
            } catch (err) {
                if (forceStereo) {
                    console.warn('Strict stereo not supported, falling back');
                    rawStream = await navigator.mediaDevices.getDisplayMedia({
                        video: videoConstraints,
                        audio: { echoCancellation: false, channelCount: 2 }
                    });
                } else throw err;
            }

            localStream = await processAudioToStereo(rawStream);

        } else {
            // --- File Streaming Logic (New) ---
            if (!fileVideoEl.src) return alert('Please select a file first');

            // Safari compat: Unmute to capture audio via Web Audio API
            fileVideoEl.muted = false;
            fileVideoEl.volume = 1;

            await fileVideoEl.play();
            updateFileControls(); // Start UI loop

            // Disable setup inputs
            document.getElementById('file-input').disabled = true;
            document.getElementById('aspect-ratio').disabled = true;
            document.getElementById('scale-mode').disabled = true;

            // --- 1. Audio Capture (Cross-Browser) ---
            // We use Web Audio API to capture audio from the video element.
            // This works in Safari where .captureStream() is missing on video elements.
            // It also handles redirecting audio to the stream so it doesn't play out of speakers (avoiding echo).

            if (!audioContext) {
                audioContext = new AudioContext({ sampleRate: 48000 });
            }
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // Create a source from the video element
            // Note: We need to ensure we don't create multiple sources for the same element if we restart stream
            if (!fileVideoEl._source) {
                fileVideoEl._source = audioContext.createMediaElementSource(fileVideoEl);
            }

            // Create a destination for the stream
            const dest = audioContext.createMediaStreamDestination();
            fileVideoEl._source.connect(dest);

            // Also connect to destination if we want local playback? 
            // In ChinShare, local playback is via #main-video (which is muted to avoid echo).
            // fileVideoEl is hidden. If we connect source->dest, it stops playing to speakers.
            // This is desired. The stream will have audio. #main-video will get the stream.
            // #main-video is muted locally. 
            // So: Broadcaster sees video, NO audio locally (to prevent echo/feedback loop if they have speakers on).
            // Perfect.

            let audioTracks = dest.stream.getAudioTracks();

            // --- 2. Video Capture ---
            let videoStream;

            // Check if we can use native captureStream (Chrome/Firefox) AND we want original ratio
            // Safari does NOT support captureStream on video elements, so this check will fail there.
            const canCaptureNative = (typeof fileVideoEl.captureStream === 'function') || (typeof fileVideoEl.mozCaptureStream === 'function');

            if (fileAspectRatio === 'original' && fileScaleMode === 'contain' && canCaptureNative) {
                // Use native capture if available and no processing needed
                const stream = fileVideoEl.captureStream ? fileVideoEl.captureStream() : fileVideoEl.mozCaptureStream();
                videoStream = stream;
            } else {
                // Formatting/Processing needed OR Safari (fallback to Canvas)

                // Canvas Processing Loop
                const drawCanvas = () => {
                    if (fileVideoEl.paused || fileVideoEl.ended) {
                        if (!fileVideoEl.ended) requestAnimationFrame(drawCanvas);
                        return;
                    }

                    const vw = fileVideoEl.videoWidth;
                    const vh = fileVideoEl.videoHeight;

                    if (vw === 0 || vh === 0) {
                        requestAnimationFrame(drawCanvas);
                        return;
                    }

                    // Target Aspect Ratio
                    let targetRatio = vw / vh;
                    if (fileAspectRatio === '16:9') targetRatio = 16 / 9;
                    if (fileAspectRatio === '4:3') targetRatio = 4 / 3;
                    if (fileAspectRatio === '21:9') targetRatio = 21 / 9;

                    // Set canvas size (keep it high res)
                    const baseHeight = 1080;
                    const baseWidth = Math.round(baseHeight * targetRatio);

                    if (fileCanvas.width !== baseWidth || fileCanvas.height !== baseHeight) {
                        fileCanvas.width = baseWidth;
                        fileCanvas.height = baseHeight;
                    }

                    // Clear
                    fileCtx.fillStyle = 'black';
                    fileCtx.fillRect(0, 0, fileCanvas.width, fileCanvas.height);

                    // Calculate Dimensions based on Scale Mode
                    let drawW, drawH, dx, dy;

                    if (fileScaleMode === 'stretch') {
                        // Stretch to fill entire canvas (distort)
                        drawW = baseWidth;
                        drawH = baseHeight;
                        dx = 0;
                        dy = 0;
                    } else if (fileScaleMode === 'cover') {
                        // Cover (Crop)
                        const scale = Math.max(baseWidth / vw, baseHeight / vh);
                        drawW = vw * scale;
                        drawH = vh * scale;
                        dx = (baseWidth - drawW) / 2;
                        dy = (baseHeight - drawH) / 2;
                    } else {
                        // Contain (Default - Black Bars)
                        const scale = Math.min(baseWidth / vw, baseHeight / vh);
                        drawW = vw * scale;
                        drawH = vh * scale;
                        dx = (baseWidth - drawW) / 2;
                        dy = (baseHeight - drawH) / 2;
                    }

                    fileCtx.drawImage(fileVideoEl, dx, dy, drawW, drawH);

                    requestAnimationFrame(drawCanvas);
                };

                requestAnimationFrame(drawCanvas);
                videoStream = fileCanvas.captureStream(60);
            }

            // Combine
            localStream = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...audioTracks
            ]);

            // Show File Controls
            document.getElementById('file-controls').classList.remove('hidden');
        }

        // --- Common Setup ---
        showView('stage');

        // Show Info Bar & Controls
        document.getElementById('info-bar').classList.remove('hidden');
        document.getElementById('info-bar').style.position = 'absolute';
        document.getElementById('info-bar').style.top = '20px';
        document.getElementById('stage-room-code').innerText = 'Code: ' + currentRoomId;
        document.getElementById('broadcaster-controls').classList.remove('hidden');

        // Toggle Switch Button visibility
        const switchBtn = document.querySelector('button[onclick="changeScreen()"]');
        if (switchBtn) {
            if (broadcastSource === 'file') switchBtn.classList.add('hidden');
            else switchBtn.classList.remove('hidden');
        }

        // Setup local preview
        document.getElementById('main-video').srcObject = localStream;

        // Mute local preview only if screen sharing (to avoid mic echo)
        // If file sharing, we want to hear the audio!
        document.getElementById('main-video').muted = (broadcastSource === 'screen');
        if (broadcastSource === 'file') {
            document.getElementById('main-video').volume = 1;
            // Update UI mute button state
            document.getElementById('mute-btn').innerText = '🔊';
        }

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

    } catch (e) {
        console.error(e);
        alert('Error starting stream: ' + e.message);
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
        let rawStream;
        const forceStereo = document.getElementById('force-stereo').checked;

        let audioConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            sampleRate: 48000
        };

        if (forceStereo) {
            audioConstraints = {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                googEchoCancellation: false,
                googAutoGainControl: false,
                googNoiseSuppression: false,
                googHighpassFilter: false,
                channelCount: { ideal: 2, min: 2 },
                sampleRate: 48000
            };
        }

        try {
            rawStream = await navigator.mediaDevices.getDisplayMedia({
                video: videoConstraints,
                audio: audioConstraints
            });
        } catch (err) {
            if (forceStereo) {
                console.warn('Strict stereo input failed fallback:', err);
                rawStream = await navigator.mediaDevices.getDisplayMedia({
                    video: videoConstraints,
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        channelCount: 2
                    }
                });
            } else {
                throw err;
            }
        }

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
    // Immediate silence
    const mainVideo = document.getElementById('main-video');
    if (mainVideo) {
        mainVideo.muted = true;
        mainVideo.pause();
        mainVideo.srcObject = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }

    // Stop file playback if active
    if (typeof fileVideoEl !== 'undefined' && fileVideoEl) {
        fileVideoEl.pause();
        fileVideoEl.muted = true;
    }

    // Close audio context if active
    if (typeof audioContext !== 'undefined' && audioContext && audioContext.state !== 'closed') {
        audioContext.close();
    }

    // No alert, just reload to reset state cleanly
    window.location.reload();
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
