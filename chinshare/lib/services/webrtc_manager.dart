import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'signaling_service.dart';

class WebRTCManager {
  final SignalingService signaling;
  MediaStream? localStream;

  // Broadcaster states
  final Set<String> connectedViewers = {};
  final Map<String, RTCPeerConnection> viewerConnections = {};

  // Viewer state
  RTCPeerConnection? broadcasterConnection;
  Function(MediaStream)? onRemoteStreamAdd;
  Function()? onRemoteStreamRemove;

  WebRTCManager(this.signaling) {
    _initSignalingListeners();
  }

  void _initSignalingListeners() {
    signaling.on('viewer-connect', (data) async {
      String id = data['id'];
      await _handleViewerConnect(id);
    });

    signaling.on('offer', (data) async {
      await _handleOffer(data);
    });

    signaling.on('answer', (data) async {
      await _handleAnswer(data);
    });

    signaling.on('candidate', (data) async {
      await _handleCandidate(data);
    });

    signaling.on('viewer-disconnect', (data) async {
      String id = data['id'];
      await _handleViewerDisconnect(id);
    });

    signaling.on('broadcaster-disconnected', (data) async {
      _handleBroadcasterDisconnect();
    });
  }

  Future<RTCPeerConnection> _createPeerConnection() async {
    Map<String, dynamic> configuration = {
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
      ],
    };
    RTCPeerConnection pc = await createPeerConnection(configuration);

    // Add unified connection monitoring to help track the 'glitch' and 'waiting' issues
    pc.onConnectionState = (RTCPeerConnectionState state) {
      print('Peer connection state changed to: $state');
    };

    pc.onIceConnectionState = (RTCIceConnectionState state) {
      print('ICE connection state changed to: $state');
    };

    return pc;
  }

  Future<void> _handleViewerConnect(String viewerId) async {
    connectedViewers.add(viewerId);
    if (localStream != null) {
      await _initiateConnection(viewerId);
    }
  }

  Future<void> _initiateConnection(String viewerId) async {
    if (viewerConnections.containsKey(viewerId)) return;

    try {
      RTCPeerConnection pc = await _createPeerConnection();
      viewerConnections[viewerId] = pc;

      // Add local tracks to peer connection
      if (localStream != null) {
        for (var track in localStream!.getTracks()) {
          await pc.addTrack(track, localStream!);
        }
      }

      pc.onIceCandidate = (candidate) {
        signaling.send('candidate', {
          'candidate': candidate.toMap(),
          'to': viewerId,
        });
      };

      RTCSessionDescription offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      signaling.send('offer', {'to': viewerId, 'sdp': offer.toMap()});
      print('Broadcaster sent offer to viewer $viewerId');
    } catch (e) {
      print('Error handling viewer connect: $e');
    }
  }

  Future<void> _handleOffer(Map<String, dynamic> data) async {
    try {
      if (signaling.role != 'viewer') return;

      broadcasterConnection ??= await _createPeerConnection();

      broadcasterConnection!.onIceCandidate = (candidate) {
        signaling.send('candidate', {'candidate': candidate.toMap()});
      };

      broadcasterConnection!.onAddStream = (stream) {
        print('Viewer received remote stream!');
        onRemoteStreamAdd?.call(stream);
      };

      broadcasterConnection!.onTrack = (RTCTrackEvent event) {
        if (event.streams.isNotEmpty) {
          print(
            'Viewer received remote track! stream ID: ${event.streams[0].id}',
          );
          onRemoteStreamAdd?.call(event.streams[0]);
        }
      };

      broadcasterConnection!.onRemoveStream = (stream) {
        print('Viewer removed remote stream!');
        onRemoteStreamRemove?.call();
      };

      await broadcasterConnection!.setRemoteDescription(
        RTCSessionDescription(data['sdp']['sdp'], data['sdp']['type']),
      );

      RTCSessionDescription answer = await broadcasterConnection!
          .createAnswer();
      await broadcasterConnection!.setLocalDescription(answer);

      signaling.send('answer', {
        'sdp': answer.toMap(),
        'from': signaling.viewerId,
      });
      print('Viewer sent answer to broadcaster');
    } catch (e) {
      print('Error handling offer: $e');
    }
  }

  Future<void> _handleAnswer(Map<String, dynamic> data) async {
    try {
      if (signaling.role == 'broadcaster') {
        String? from = data['from'];
        if (from != null && viewerConnections.containsKey(from)) {
          await viewerConnections[from]!.setRemoteDescription(
            RTCSessionDescription(data['sdp']['sdp'], data['sdp']['type']),
          );
          print('Broadcaster set remote description for viewer $from');
        } else {
          print('Broadcaster received answer but viewer ID $from not found');
        }
      } else {
        if (broadcasterConnection != null) {
          await broadcasterConnection!.setRemoteDescription(
            RTCSessionDescription(data['sdp']['sdp'], data['sdp']['type']),
          );
        }
      }
    } catch (e) {
      print('Error handling answer: $e');
    }
  }

  Future<void> _handleCandidate(Map<String, dynamic> data) async {
    try {
      RTCIceCandidate candidate = RTCIceCandidate(
        data['candidate']['candidate'],
        data['candidate']['sdpMid'],
        data['candidate']['sdpMLineIndex'],
      );

      if (signaling.role == 'broadcaster') {
        String? from = data['from'];
        if (from != null && viewerConnections.containsKey(from)) {
          await viewerConnections[from]!.addCandidate(candidate);
        }
      } else {
        if (broadcasterConnection != null) {
          await broadcasterConnection!.addCandidate(candidate);
        }
      }
    } catch (e) {
      print('Error handling candidate: $e');
    }
  }

  Future<void> _handleViewerDisconnect(String viewerId) async {
    if (viewerConnections.containsKey(viewerId)) {
      await viewerConnections[viewerId]?.close();
      viewerConnections.remove(viewerId);
    }
  }

  void _handleBroadcasterDisconnect() {
    onRemoteStreamRemove?.call();
    broadcasterConnection?.close();
    broadcasterConnection = null;
  }

  Future<List<DesktopCapturerSource>> getDesktopSources() async {
    if (WebRTC.platformIsDesktop) {
      return await desktopCapturer.getSources(
        types: [SourceType.Screen, SourceType.Window],
      );
    }
    return [];
  }

  Future<void> startScreenShare({DesktopCapturerSource? source}) async {
    try {
      // Use desktopCapturer for desktop platforms to avoid macOS screen glitch bugs
      if (WebRTC.platformIsDesktop && source != null) {
        localStream = await navigator.mediaDevices.getDisplayMedia(
          <String, dynamic>{
            'video': {
              'deviceId': {'exact': source.id},
              'mandatory': {'frameRate': 30.0},
            },
            'audio': false,
          },
        );
      } else {
        final Map<String, dynamic> mediaConstraints = {
          'audio': true,
          'video': true,
        };
        localStream = await navigator.mediaDevices.getDisplayMedia(
          mediaConstraints,
        );
      }
      if (localStream != null) {
        for (var viewerId in connectedViewers) {
          await _initiateConnection(viewerId);
        }
      }
    } catch (e) {
      print('Error starting screen share: $e');
    }
  }

  void stopLocalStream() {
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  void dispose() {
    stopLocalStream();
    for (var pc in viewerConnections.values) {
      pc.close();
    }
    viewerConnections.clear();
    broadcasterConnection?.close();
    broadcasterConnection = null;
  }
}
