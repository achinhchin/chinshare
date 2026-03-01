import 'package:flutter/material.dart';
import '../services/signaling_service.dart';
import 'stage_screen.dart';

class SetupScreen extends StatefulWidget {
  final SignalingService signaling;
  final String roomId;

  const SetupScreen({Key? key, required this.signaling, required this.roomId})
    : super(key: key);

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  String _sourceType = 'screen'; // 'screen', 'file', 'url'

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Setup Sharing')),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            const Text('Your Room Code', style: TextStyle(fontSize: 18)),
            const SizedBox(height: 10),
            Text(
              widget.roomId,
              style: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                letterSpacing: 4.0,
              ),
            ),
            const SizedBox(height: 30),

            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'screen', label: Text('Screen')),
                ButtonSegment(value: 'file', label: Text('File')),
                ButtonSegment(value: 'url', label: Text('URL')),
              ],
              selected: {_sourceType},
              onSelectionChanged: (Set<String> newSelection) {
                setState(() {
                  _sourceType = newSelection.first;
                });
              },
            ),

            const SizedBox(height: 30),

            if (_sourceType == 'file') ...[
              const Text('File sharing logic to be implemented'),
            ] else if (_sourceType == 'url') ...[
              const TextField(
                decoration: InputDecoration(
                  hintText: 'Paste Video URL',
                  border: OutlineInputBorder(),
                ),
              ),
            ],

            const Spacer(),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(
                      builder: (context) => StageScreen(
                        signaling: widget.signaling,
                        roomId: widget.roomId,
                        isBroadcaster: true,
                        sourceType: _sourceType,
                      ),
                    ),
                  );
                },
                child: const Text('Start Sharing'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
