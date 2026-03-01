import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../services/signaling_service.dart';
import '../services/webrtc_manager.dart';
import 'home_screen.dart';

class StageScreen extends StatefulWidget {
  final SignalingService signaling;
  final String roomId;
  final bool isBroadcaster;
  final String sourceType;

  const StageScreen({
    Key? key,
    required this.signaling,
    required this.roomId,
    this.isBroadcaster = false,
    this.sourceType = 'screen',
  }) : super(key: key);

  @override
  State<StageScreen> createState() => _StageScreenState();
}

class _StageScreenState extends State<StageScreen> {
  late WebRTCManager _webRTCManager;
  final RTCVideoRenderer _localRenderer = RTCVideoRenderer();
  final RTCVideoRenderer _remoteRenderer = RTCVideoRenderer();

  bool _isInit = false;
  int _viewerCount = 0;
  bool _isWaiting = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initWebRTC();
    });
  }

  Future<void> _initWebRTC() async {
    _webRTCManager = WebRTCManager(widget.signaling);
    await _localRenderer.initialize();
    await _remoteRenderer.initialize();

    if (widget.isBroadcaster) {
      if (widget.sourceType == 'screen') {
        if (WebRTC.platformIsDesktop) {
          final sources = await _webRTCManager.getDesktopSources();
          if (!mounted) return;

          DesktopCapturerSource? selectedSource =
              await showDialog<DesktopCapturerSource>(
                context: context,
                barrierDismissible: false,
                builder: (context) {
                  return AlertDialog(
                    title: const Text('Select Screen or Window'),
                    content: SizedBox(
                      width: 500,
                      height: 400,
                      child: ListView.builder(
                        itemCount: sources.length,
                        itemBuilder: (context, index) {
                          final source = sources[index];
                          return ListTile(
                            leading: Icon(
                              source.type == SourceType.Window
                                  ? Icons.window
                                  : Icons.desktop_mac,
                            ),
                            title: Text(source.name),
                            onTap: () => Navigator.pop(context, source),
                          );
                        },
                      ),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(context, null),
                        child: const Text('Cancel'),
                      ),
                    ],
                  );
                },
              );

          if (selectedSource != null) {
            await _webRTCManager.startScreenShare(source: selectedSource);
            _localRenderer.srcObject = _webRTCManager.localStream;
          } else {
            _leaveRoom();
            return;
          }
        } else {
          await _webRTCManager.startScreenShare();
          _localRenderer.srcObject = _webRTCManager.localStream;
        }
      }
      // TODO: Handle 'file' and 'url' sources
      if (mounted) {
        setState(() {
          _isWaiting = false;
        });
      }
    } else {
      // Viewer logic
      _webRTCManager.onRemoteStreamAdd = (stream) {
        setState(() {
          _remoteRenderer.srcObject = stream;
          _isWaiting = false;
        });
      };

      _webRTCManager.onRemoteStreamRemove = () {
        setState(() {
          _remoteRenderer.srcObject = null;
          _isWaiting = true;
        });
      };
    }

    // Listen to signaling events for UI updates
    widget.signaling.on('viewer-connect', (data) {
      setState(() => _viewerCount++);
    });

    widget.signaling.on('viewer-disconnect', (data) {
      setState(() => _viewerCount = (_viewerCount > 0) ? _viewerCount - 1 : 0);
    });

    widget.signaling.on('broadcaster-disconnected', (data) {
      setState(() => _isWaiting = true);
    });

    setState(() {
      _isInit = true;
    });
  }

  @override
  void dispose() {
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    _webRTCManager.dispose();
    super.dispose();
  }

  void _leaveRoom() {
    widget.signaling.disconnect();
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (context) => HomeScreen(signaling: widget.signaling),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_isInit) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Main Video Area
          if (widget.isBroadcaster)
            RTCVideoView(
              _localRenderer,
              objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
            )
          else
            _isWaiting
                ? const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(color: Colors.white),
                        SizedBox(height: 20),
                        Text(
                          'Waiting for host...',
                          style: TextStyle(color: Colors.white, fontSize: 18),
                        ),
                      ],
                    ),
                  )
                : RTCVideoView(
                    _remoteRenderer,
                    objectFit:
                        RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                  ),

          // Top Info Bar
          Positioned(
            top: 40,
            left: 20,
            right: 20,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black54,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Code: ${widget.roomId}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Row(
                    children: [
                      const Icon(Icons.person, color: Colors.white, size: 16),
                      const SizedBox(width: 4),
                      Text(
                        '$_viewerCount',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // Bottom Controls
          Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.isBroadcaster)
                  FloatingActionButton(
                    heroTag: 'stop_btn',
                    backgroundColor: Colors.red,
                    onPressed: _leaveRoom,
                    child: const Icon(Icons.stop),
                  )
                else
                  FloatingActionButton(
                    heroTag: 'leave_btn',
                    backgroundColor: Colors.red,
                    onPressed: _leaveRoom,
                    child: const Icon(Icons.exit_to_app),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
