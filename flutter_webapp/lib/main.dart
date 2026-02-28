import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'services/signaling_service.dart';
import 'services/webrtc_service.dart';
import 'views/home_view.dart';
import 'views/setup_view.dart';
import 'views/stage_view.dart';

// Use standard WebSocket URI based on platform
String get signalingServerUri {
  if (kIsWeb) return 'ws://127.0.0.1:8000/ws';
  if (Platform.isAndroid) return 'ws://10.0.2.2:8000/ws';
  return 'ws://127.0.0.1:8000/ws';
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb || Platform.isMacOS || Platform.isWindows || Platform.isLinux) {
    // Desktop and web initialization if needed
  }
  runApp(const ChinShareApp());
}

class ChinShareApp extends StatefulWidget {
  const ChinShareApp({Key? key}) : super(key: key);

  @override
  State<ChinShareApp> createState() => _ChinShareAppState();
}

class _ChinShareAppState extends State<ChinShareApp> {
  late SignalingService signaling;
  late WebRTCService webrtc;
  int _currentIndex = 0; // 0=Home, 1=Setup(Broadcaster), 2=Stage(Viewer)
  ThemeMode _themeMode = ThemeMode.dark;

  @override
  void initState() {
    super.initState();
    signaling = SignalingService();
    signaling.connect(signalingServerUri);
    webrtc = WebRTCService(signaling);

    webrtc.onRoomCreated = (roomId) {
      if (mounted) {
        setState(() => _currentIndex = 1); // Setup view
      }
    };

    webrtc.onJoinedRoom = (roomId, myId) {
      if (mounted) {
        setState(() => _currentIndex = 2); // Stage view as viewer
      }
    };
  }

  @override
  void dispose() {
    webrtc.dispose();
    signaling.dispose();
    super.dispose();
  }

  void _toggleTheme() {
    setState(() {
      _themeMode = _themeMode == ThemeMode.light ? ThemeMode.dark : ThemeMode.light;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ChinShare',
      theme: ThemeData.light().copyWith(
        primaryColor: Colors.blue,
        scaffoldBackgroundColor: const Color(0xfff5f5f5),
      ),
      darkTheme: ThemeData.dark().copyWith(
        primaryColor: Colors.blueAccent,
        scaffoldBackgroundColor: const Color(0xff121212),
        cardColor: const Color(0xff1e1e1e),
      ),
      themeMode: _themeMode,
      home: Scaffold(
        appBar: AppBar(
          title: const Text('ChinShare'),
          actions: [
            IconButton(
              icon: Icon(_themeMode == ThemeMode.light ? Icons.dark_mode : Icons.light_mode),
              onPressed: _toggleTheme,
            ),
          ],
        ),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: _currentIndex == 0
          ? HomeView(webrtc: webrtc)
          : _currentIndex == 1
              ? SetupView(
                  webrtc: webrtc,
                  onStartSharing: () => setState(() => _currentIndex = 2),
                )
              : StageView(webrtc: webrtc, onStop: () => setState(() => _currentIndex = 0)),
    );
  }
}
