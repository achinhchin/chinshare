import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

typedef OnLocalStream = void Function(MediaStream stream);
typedef OnRemoteStream = void Function(MediaStream stream);
typedef OnJoined = void Function(String roomId, String id);
typedef OnRoomCreated = void Function(String roomId);
typedef OnError = void Function(String message);
typedef OnViewerCountUpdate = void Function(int count);

class SignalingService {
  WebSocketChannel? _channel;
  String? _myId;
  String? _currentRoomId;
  String? _role; // 'broadcaster' or 'viewer'
  
  // Broadcaster: Map of viewerId -> RTCPeerConnection
  final Map<String, RTCPeerConnection> _viewerPCs = {};
  
  // Viewer: Single RTCPeerConnection
  RTCPeerConnection? _viewerPC;
  
  MediaStream? _localStream;
  
  OnLocalStream? onLocalStream;
  OnRemoteStream? onRemoteStream;
  OnJoined? onJoined;
  OnRoomCreated? onRoomCreated;
  OnError? onError;
  OnViewerCountUpdate? onViewerCountUpdate;
  
  final _viewers = <String>{}; // Set of connected viewer IDs
  
  void connect(String url) {
    print('Connecting to $url');
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      _channel!.stream.listen(_onMessage, onDone: () {
        print('WS Closed');
        onError?.call('Disconnected from server');
      }, onError: (e) {
        print('WS Error: $e');
        onError?.call('Connection error: $e');
      });
    } catch (e) {
       onError?.call('Invalid URL: $e');
    }
  }

  void _onMessage(dynamic message) {
    if (message is String) {
      final Map<String, dynamic> data = jsonDecode(message);
      // print('Msg: ${data['type']}');
      
      switch (data['type']) {
        case 'room-created':
          _currentRoomId = data['roomId'];
          onRoomCreated?.call(_currentRoomId!);
          break;
          
        case 'joined-room':
          _currentRoomId = data['roomId'];
          _myId = data['viewerId'];
          onJoined?.call(_currentRoomId!, _myId!);
          break;
          
        case 'error':
          onError?.call(data['message']);
          break;
          
        case 'viewer-connect':
          _handleViewerConnect(data['id']);
          break;
          
        case 'offer':
          _handleOffer(data);
          break;
          
        case 'answer':
          _handleAnswer(data);
          break;
        
        case 'candidate':
          _handleCandidate(data);
          break;
          
        case 'viewer-disconnect':
          _handleViewerDisconnect(data['id']);
          break;
          
        case 'room-closed':
          onError?.call('Broadcaster ended the session');
          _closeAll();
          break;
      }
    }
  }
  
  // --- Actions ---
  
  void createRoom() {
    _role = 'broadcaster';
    _send({'type': 'create-room'});
  }
  
  void joinRoom(String roomId) {
    _role = 'viewer';
    _send({'type': 'join-room', 'roomId': roomId});
  }
  
  Future<void> startScreenShare({
    required bool captureAudio,
    int width = 1920,
    int height = 1080,
    int frameRate = 60
  }) async {
    final Map<String, dynamic> mediaConstraints = {
      'audio': captureAudio, // Native WebRTC handles system audio better
      'video': {
        'mandatory': {
          'minWidth': '1280', 
          'minHeight': '720',
          'minFrameRate': '30',
        },
        'optional': [],
      }
    };
    
    // On Desktop, getDisplayMedia logic overrides constraints for resolution usually, 
    // but we pass them anyway.
    try {
      if (Platform.isAndroid || Platform.isIOS) {
        // Mobile usually requires a foreground service or specific setup for screen share
        // flutter_webrtc's getDisplayMedia handles this via MediaProjection on Android
        // On iOS it needs Broadcast Extension (complex). 
        // We will assume Android/Desktop for broadcasting for now.
        _localStream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);
      } else {
        // Desktop
         _localStream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);
      }
      
      onLocalStream?.call(_localStream!);
      
      // If we have viewers, connect to them
      for (var viewerId in _viewers) {
        _initiateConnection(viewerId);
      }
      
    } catch (e) {
      print('Error getting display media: $e');
      onError?.call('Failed to capture screen: $e');
    }
  }
  
  Future<void> stopSharing() async {
    _localStream?.getTracks().forEach((t) => t.stop());
    _localStream = null;
    // Notify server? Or just keep room open?
    // User usually just closes app or we reset state
  }
  
  void _send(Map<String, dynamic> data) {
    _channel?.sink.add(jsonEncode(data));
  }
  
  // --- WebRTC Logic ---
  
  Future<RTCPeerConnection> _createPeerConnection(String targetId) async {
    final pc = await createPeerConnection({
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'}
      ]
    });
    
    pc.onIceCandidate = (candidate) {
      _send({
        'type': 'candidate',
        'candidate': {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex
        },
        'to': targetId, // Recipient
        'from': _myId,
        'roomId': _currentRoomId,
      });
    };
    
    return pc;
  }
  
  // Broadcaster Logic
  void _handleViewerConnect(String viewerId) {
    print('Viewer joined: $viewerId');
    _viewers.add(viewerId);
    onViewerCountUpdate?.call(_viewers.length);
    
    if (_localStream != null) {
      _initiateConnection(viewerId);
    }
  }
  
  void _handleViewerDisconnect(String viewerId) {
    _viewers.remove(viewerId);
    onViewerCountUpdate?.call(_viewers.length);
    
    if (_viewerPCs.containsKey(viewerId)) {
      _viewerPCs[viewerId]?.close();
      _viewerPCs.remove(viewerId);
    }
  }
  
  Future<void> _initiateConnection(String viewerId) async {
    if (_viewerPCs.containsKey(viewerId)) return;
    
    final pc = await _createPeerConnection(viewerId);
    _viewerPCs[viewerId] = pc;
    
    _localStream!.getTracks().forEach((track) {
      pc.addTrack(track, _localStream!);
    });
    
    var offer = await pc.createOffer();
    
    // SDP Munging for Stereo
    var sdp = _upgradeAudioQuality(offer.sdp!);
    offer = RTCSessionDescription(sdp, offer.type);
    
    await pc.setLocalDescription(offer);
    
    _send({
      'type': 'offer',
      'sdp': offer.toMap(),
      'to': viewerId,
      'roomId': _currentRoomId
    });
  }
  
  // Viewer Logic
  Future<void> _handleOffer(Map<String, dynamic> data) async {
    // Only viewer receives offer in this flow
    _role = 'viewer';
    
    if (_viewerPC != null) {
      await _viewerPC!.close();
    }
    
    // Sender ID is effectively the broadcaster, but we use null as targetId for sending BACK to broadcaster ? 
    // Wait, createPeerConnection arg is 'targetId' for my tracking.
    // For viewer, we interact with "broadcaster".
    
    final pc = await _createPeerConnection(''); // No targetId needed for viewer to send candidates globally? 
    // Actually our protocol uses 'from'/'to'. Viewer sends to Broadcaster (which handled by server if to is missing? or broadcaster ID?)
    // In server script: 
    // Header logic:
    // BROADCASTER: sends to 'viewerId'
    // VIEWER: sends to? Server logic: "if role=viewer, send to broadcaster".
    // So 'to' is not strictly needed for Viewer -> Broadcaster messages in our server logic.
    
    _viewerPC = pc;
    
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        onRemoteStream?.call(event.streams[0]);
      }
    };
    
    await pc.setRemoteDescription(RTCSessionDescription(
      data['sdp']['sdp'],
      data['sdp']['type']
    ));
    
    var answer = await pc.createAnswer();
    
    // Stereo munging on answer too? Usually safe to do so.
    var sdp = _upgradeAudioQuality(answer.sdp!);
    answer = RTCSessionDescription(sdp, answer.type);
    
    await pc.setLocalDescription(answer);
    
    _send({
      'type': 'answer',
      'sdp': answer.toMap(),
      'roomId': _currentRoomId,
      'from': _myId
    });
  }
  
  Future<void> _handleAnswer(Map<String, dynamic> data) async {
    // Broadcaster receives answer
    final fromId = data['from'];
    if (_viewerPCs.containsKey(fromId)) {
      final pc = _viewerPCs[fromId]!;
      await pc.setRemoteDescription(RTCSessionDescription(
        data['sdp']['sdp'],
        data['sdp']['type']
      ));
    }
  }
  
  Future<void> _handleCandidate(Map<String, dynamic> data) async {
    final candidate = RTCIceCandidate(
      data['candidate']['candidate'],
      data['candidate']['sdpMid'],
      data['candidate']['sdpMLineIndex']
    );
    
    if (_role == 'broadcaster') {
      final fromId = data['from']; // Check who sent it
      // Our server logic: if broadcaster receives, it's from a viewer.
      // But server logic says: "if sData.role === 'broadcaster' ... viewers.get(to).send"
      // Wait, Candidate direction:
      // Viewer -> Server -> Broadcaster
      // Broadcaster -> Server -> Viewer
      
      // If I am Broadcaster, I received this FROM a viewer. But did server pass 'from'? 
      // Server logic: "room.broadcaster.send(data)" (no injection of 'from' here? WAIT)
      
      // Let's check server index.ts:
      // case 'candidate': ... if (sData.role !== 'broadcaster') { room.broadcaster.send(data); }
      // It sends the RAW data object sent by Viewer.
      // Viewer sent: { type: candidate, candidate: ..., roomId: ... }
      // Viewer DID NOT send 'from' in my `script.js` logic originally!
      // Wait, `script.js` viewer logic: `ws.send({... from: myId ...})` inside `pc.onicecandidate`.
      // YES, `script.js` has `from: myId`.
      
      final from = data['from'];
      if (from != null && _viewerPCs.containsKey(from)) {
        await _viewerPCs[from]!.addCandidate(candidate);
      }
    } else {
      // Viewer receiving from Broadcaster
      if (_viewerPC != null) {
        await _viewerPC!.addCandidate(candidate);
      }
    }
  }
  
  String _upgradeAudioQuality(String sdp) {
    // Force Stereo and CBR
    return sdp.replaceAllMapped(RegExp(r'a=fmtp:111 (.*)'), (match) {
        var params = match.group(1)!;
        if (!params.contains('stereo=1')) params += ';stereo=1';
        if (!params.contains('sprop-stereo=1')) params += ';sprop-stereo=1';
        if (!params.contains('cbr=1')) params += ';cbr=1';
        if (!params.contains('maxaveragebitrate')) params += ';maxaveragebitrate=510000';
        return 'a=fmtp:111 $params';
    });
  }
  
  void _closeAll() {
    _channel?.sink.close();
    _viewerPC?.close();
    _viewerPCs.values.forEach((pc) => pc.close());
    _viewerPCs.clear();
    _localStream?.dispose();
  }
}
