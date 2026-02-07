import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import '../services/signaling.dart';

class StageScreen extends StatefulWidget {
  final String url;
  final String? roomId; // Null if creating
  final bool isBroadcaster;

  const StageScreen({
    super.key, 
    required this.url,
    this.roomId,
    required this.isBroadcaster,
  });

  @override
  State<StageScreen> createState() => _StageScreenState();
}

class _StageScreenState extends State<StageScreen> {
  final _signaling = SignalingService();
  final _localRenderer = RTCVideoRenderer();
  final _remoteRenderer = RTCVideoRenderer(); // Simple single remote for now
  
  String? _activeRoomId;
  int _viewerCount = 0;
  bool _controlsVisible = true;
  bool _isAudioEnabled = true; // Use system audio logic
  
  @override
  void initState() {
    super.initState();
    _activeRoomId = widget.roomId;
    WakelockPlus.enable();
    _initRenderers();
    _connect();
  }
  
  Future<void> _initRenderers() async {
    await _localRenderer.initialize();
    await _remoteRenderer.initialize();
  }
  
  void _connect() {
    _signaling.onRoomCreated = (roomId) {
      setState(() {
        _activeRoomId = roomId;
      });
      // Auto start sharing if broadcaster
      if (widget.isBroadcaster) {
        _startSharing();
      }
    };
    
    _signaling.onJoined = (roomId, myId) {
      setState(() {
        _activeRoomId = roomId;
      });
    };
    
    _signaling.onLocalStream = (stream) {
      _localRenderer.srcObject = stream;
      setState(() {});
    };
    
    _signaling.onRemoteStream = (stream) {
      _remoteRenderer.srcObject = stream;
      setState(() {});
    };
    
    _signaling.onViewerCountUpdate = (count) {
      setState(() => _viewerCount = count);
    };
    
    _signaling.onError = (msg) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: Colors.red),
        );
      }
    };
    
    _signaling.connect(widget.url);
    
    // Give WS time to connect
    Future.delayed(const Duration(milliseconds: 500), () {
      if (widget.isBroadcaster) {
        _signaling.createRoom();
      } else {
        _signaling.joinRoom(widget.roomId!);
      }
    });
  }
  
  void _startSharing() {
    // Desktop: Screen share. Mobile: Ask (but we default to screen share for now)
    // Audio: true to try capturing system audio
    _signaling.startScreenShare(captureAudio: true);
  }
  
  @override
  void dispose() {
    WakelockPlus.disable();
    _signaling.stopSharing(); // Close connections
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: () => setState(() => _controlsVisible = !_controlsVisible),
        child: Stack(
          children: [
            // Video Layer
            Center(
              child: widget.isBroadcaster
                  ? RTCVideoView(_localRenderer, mirror: false)
                  : RTCVideoView(_remoteRenderer),
            ),
            
            // Waiting UI
            if (!widget.isBroadcaster && _remoteRenderer.srcObject == null)
              const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: Colors.blueAccent),
                    SizedBox(height: 16),
                    Text('Waiting for host...', style: TextStyle(color: Colors.white54)),
                  ],
                ),
              ),
              
            // Info Bar (Top)
            if (_controlsVisible)
              Positioned(
                top: 50,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(30),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Code: ${_activeRoomId ?? "..."}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(width: 16),
                        const Icon(Icons.person, color: Colors.white54, size: 16),
                        const SizedBox(width: 4),
                        Text(
                          '$_viewerCount',
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              
            // Broadcaster Controls (Bottom)
            if (_controlsVisible && widget.isBroadcaster)
              Positioned(
                bottom: 40,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.black87,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _ControlButton(
                          icon: Icons.stop_circle_outlined,
                          label: 'Stop',
                          color: Colors.redAccent,
                          onPressed: () {
                            // Stop and go back
                            Navigator.pop(context);
                          },
                        ),
                        // Add more controls like Audio Quality toggle later
                      ],
                    ),
                  ),
                ),
              ),
              
            // Viewer Controls (Bottom) - e.g. Fullscreen toggle logic or just simple overlay
          ],
        ),
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onPressed;

  const _ControlButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(color: color, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
