import 'package:flutter/material.dart';
import '../services/signaling_service.dart';
import 'setup_screen.dart';
import 'stage_screen.dart';

class HomeScreen extends StatefulWidget {
  final SignalingService signaling;

  const HomeScreen({Key? key, required this.signaling}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TextEditingController _codeController = TextEditingController();
  bool _isConnected = false;

  @override
  void initState() {
    super.initState();
    _connectSignaling();
  }

  void _connectSignaling() {
    // Determine signaling server URL (localhost for testing or specific IP)
    String wsUrl =
        'ws://localhost:8000/ws'; // Update with proper URL for devices
    widget.signaling.connect(wsUrl);

    // In a real app we'd wait for connection open, assuming true for now
    setState(() {
      _isConnected = true;
    });

    widget.signaling.on('room-created', (data) {
      String roomId = data['roomId'];
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (context) =>
              SetupScreen(signaling: widget.signaling, roomId: roomId),
        ),
      );
    });

    widget.signaling.on('joined-room', (data) {
      String roomId = data['roomId'];
      String viewerId = data['viewerId'];
      widget.signaling.viewerId = viewerId;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (context) =>
              StageScreen(signaling: widget.signaling, roomId: roomId),
        ),
      );
    });

    widget.signaling.on('error', (data) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(data['message'] ?? 'Unknown error')),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: GestureDetector(
        onTap: () {
          print('Scaffold body tapped!');
        },
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'ChinShare',
                  style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Simple & Fast Screen Sharing',
                  style: TextStyle(fontSize: 16, color: Colors.grey),
                ),
                const SizedBox(height: 40),

                ElevatedButton(
                  onPressed: _isConnected
                      ? () {
                          print('Create Share Room button pressed!');
                          widget.signaling.createRoom();
                        }
                      : null,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(200, 50),
                  ),
                  child: Text(
                    _isConnected ? 'Create Share Room' : 'Connecting...',
                  ),
                ),

                const SizedBox(height: 20),
                const Text('OR', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 20),

                SizedBox(
                  width: 200,
                  child: TextField(
                    controller: _codeController,
                    textAlign: TextAlign.center,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      hintText: 'Room Code',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),

                const SizedBox(height: 10),

                OutlinedButton(
                  onPressed: _isConnected
                      ? () {
                          if (_codeController.text.length == 6) {
                            widget.signaling.joinRoom(_codeController.text);
                          }
                        }
                      : null,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(200, 50),
                  ),
                  child: Text(_isConnected ? 'Join Room' : 'Connecting...'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
