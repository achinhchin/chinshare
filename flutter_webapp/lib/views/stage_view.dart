import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../services/webrtc_service.dart';

class StageView extends StatefulWidget {
  final WebRTCService webrtc;
  final VoidCallback onStop;

  const StageView({Key? key, required this.webrtc, required this.onStop}) : super(key: key);

  @override
  State<StageView> createState() => _StageViewState();
}

class _StageViewState extends State<StageView> {
  bool _showStats = false;
  
  @override
  void initState() {
    super.initState();
    widget.webrtc.onStreamStarted = () {
      if (mounted) setState(() {});
    };
    widget.webrtc.onRemoteStreamAdded = () {
      if (mounted) setState(() {});
    };
  }

  void _stopSharing() {
    widget.webrtc.stopScreenShare();
    widget.onStop();
  }

  @override
  Widget build(BuildContext context) {
    final isBroadcaster = widget.webrtc.role == Role.broadcaster;
    final renderer = isBroadcaster ? widget.webrtc.localRenderer : widget.webrtc.remoteRenderer;
    final hasVideo = isBroadcaster ? widget.webrtc.localStream != null : widget.webrtc.remoteStream != null;

    return Stack(
      children: [
        // Video Stage
        Container(
          color: Colors.black,
          child: Center(
            child: hasVideo || (isBroadcaster && widget.webrtc.localStream != null) || (!isBroadcaster && renderer.srcObject != null)
                ? RTCVideoView(
                    renderer,
                    objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                  )
                : const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Waiting for video...', style: TextStyle(color: Colors.white)),
                    ],
                  ),
          ),
        ),

        // Info Bar
        Positioned(
          top: 16,
          left: 16,
          child: SafeArea(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black54,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Code: ${widget.webrtc.roomId ?? "------"}',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(width: 16),
                  if (widget.webrtc.role == Role.viewer)
                    const Text('👤 Viewer', style: TextStyle(color: Colors.white70)),
                  if (widget.webrtc.role == Role.broadcaster)
                    const Text('📡 Broadcaster', style: TextStyle(color: Colors.white70)),
                ],
              ),
            ),
          ),
        ),

        // Controls Overlay
        Positioned(
          bottom: 24,
          left: 0,
          right: 0,
          child: SafeArea(
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(30),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isBroadcaster)
                      ElevatedButton.icon(
                        onPressed: _stopSharing,
                        icon: const Icon(Icons.stop),
                        label: const Text('Stop'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.red,
                          foregroundColor: Colors.white,
                          shape: const StadiumBorder(),
                        ),
                      )
                    else ...[
                      IconButton(
                        icon: const Icon(Icons.fullscreen, color: Colors.white),
                        onPressed: () {
                          // Toggle fullscreen
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Fullscreen not implemented')),
                          );
                        },
                      ),
                      IconButton(
                        icon: Icon(Icons.exit_to_app, color: Colors.red[300]),
                        onPressed: widget.onStop,
                      ),
                    ],
                    const SizedBox(width: 16),
                    IconButton(
                      icon: const Icon(Icons.analytics, color: Colors.white),
                      onPressed: () => setState(() => _showStats = !_showStats),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Stats Overlay
        if (_showStats)
          Positioned(
            top: 70,
            left: 16,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.black87,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('WebRTC Stats', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  SizedBox(height: 8),
                  Text('Resolution: ---', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  Text('FPS: ---', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  Text('Bitrate: ---', style: TextStyle(color: Colors.white70, fontSize: 12)),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
