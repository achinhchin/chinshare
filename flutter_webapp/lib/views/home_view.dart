import 'package:flutter/material.dart';
import '../services/webrtc_service.dart';

class HomeView extends StatefulWidget {
  final WebRTCService webrtc;

  const HomeView({Key? key, required this.webrtc}) : super(key: key);

  @override
  State<HomeView> createState() => _HomeViewState();
}

class _HomeViewState extends State<HomeView> {
  final TextEditingController _roomController = TextEditingController();
  final TextEditingController _serverUrlController = TextEditingController();
  bool _isConnecting = false;
  bool _showSettings = false;

  @override
  void initState() {
    super.initState();
    _serverUrlController.text = widget.webrtc.signaling.url ?? 'ws://127.0.0.1:8000/ws';
  }

  void _createRoom() {
    setState(() => _isConnecting = true);
    final roomCode = _roomController.text.trim();
    if (_showSettings) {
      widget.webrtc.signaling.connect(_serverUrlController.text.trim());
    }
    widget.webrtc.createRoom(roomCode.length == 6 ? roomCode : null);
  }

  void _joinRoom() {
    final code = _roomController.text.trim();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Room code must be 6 characters')),
      );
      return;
    }
    setState(() => _isConnecting = true);
    if (_showSettings) {
      widget.webrtc.signaling.connect(_serverUrlController.text.trim());
    }
    widget.webrtc.joinRoom(code);
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.all(24.0),
        constraints: const BoxConstraints(maxWidth: 400),
        child: SingleChildScrollView(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'ChinShare',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Simple & Fast Screen Sharing',
              style: TextStyle(fontSize: 16, color: Theme.of(context).hintColor),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 48),
            ElevatedButton(
              onPressed: _isConnecting ? null : _createRoom,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: Text(
                _isConnecting ? 'Connecting...' : 'Create Share Room',
                style: const TextStyle(fontSize: 16),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text('OR', style: TextStyle(color: Theme.of(context).hintColor)),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _roomController,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: 'Room Code',
              ),
              maxLength: 6,
              textAlign: TextAlign.center,
              enabled: !_isConnecting,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _isConnecting ? null : _joinRoom,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: Text(
                _isConnecting ? 'Connecting...' : 'Join Room',
                style: const TextStyle(fontSize: 16),
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: _isConnecting ? null : _createRoom,
              child: const Text('Join as Broadcaster'),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              icon: Icon(_showSettings ? Icons.expand_less : Icons.settings),
              label: const Text('Server Settings'),
              onPressed: () => setState(() => _showSettings = !_showSettings),
            ),
            if (_showSettings) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _serverUrlController,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'Signaling Server URL',
                  hintText: 'ws://192.168.1.x:8000/ws',
                ),
                enabled: !_isConnecting,
              ),
            ],
          ],
        ),
        ),
      ),
    );
  }
}
