import 'package:flutter/material.dart';
import '../services/webrtc_service.dart';

class SetupView extends StatefulWidget {
  final WebRTCService webrtc;
  final VoidCallback onStartSharing;

  const SetupView({Key? key, required this.webrtc, required this.onStartSharing}) : super(key: key);

  @override
  State<SetupView> createState() => _SetupViewState();
}

class _SetupViewState extends State<SetupView> {
  String _resLimit = '1080';
  String _source = 'screen';
  bool _forceStereo = false;

  void _startBroadcasting() async {
    try {
      if (_source == 'screen') {
        await widget.webrtc.startScreenShare();
        if (!mounted) return;
        // The logic for handling stream options could go here
        widget.onStartSharing();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('File/URL sharing is not yet implemented in Flutter')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to start sharing: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.all(24.0),
        constraints: const BoxConstraints(maxWidth: 500),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Your Room Code',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  color: Colors.black12,
                  child: SelectableText(
                    widget.webrtc.roomId ?? '......',
                    style: const TextStyle(fontSize: 32, letterSpacing: 4, fontFamily: 'monospace'),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Share this code with viewers',
                  style: TextStyle(color: Theme.of(context).hintColor),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                Row(
                  children: [
                    const Text('Resolution Limit:'),
                    const SizedBox(width: 16),
                    Expanded(
                      child: DropdownButton<String>(
                        value: _resLimit,
                        isExpanded: true,
                        items: const [
                          DropdownMenuItem(value: '1080', child: Text('1080p')),
                          DropdownMenuItem(value: '720', child: Text('720p')),
                          DropdownMenuItem(value: 'unlimited', child: Text('Unlimited')),
                        ],
                        onChanged: (val) {
                          if (val != null) setState(() => _resLimit = val);
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'screen', label: Text('💻 Screen')),
                    ButtonSegment(value: 'file', label: Text('📁 File')),
                    ButtonSegment(value: 'url', label: Text('🌐 URL')),
                  ],
                  selected: {_source},
                  onSelectionChanged: (Set<String> newSelection) {
                    setState(() {
                      _source = newSelection.first;
                    });
                  },
                ),
                const SizedBox(height: 24),
                if (_source == 'file' || _source == 'url')
                  const Padding(
                    padding: EdgeInsets.only(bottom: 24.0),
                    child: Text(
                      'File/URL sharing is complex in Flutter WebRTC and not fully implemented yet.',
                      style: TextStyle(color: Colors.orange),
                    ),
                  ),
                Row(
                  children: [
                    Checkbox(
                      value: _forceStereo,
                      onChanged: (val) => setState(() => _forceStereo = val ?? false),
                    ),
                    const Text('Force Stereo (Best for Tabs)'),
                  ],
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: _startBroadcasting,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                  child: const Text('Start Sharing', style: TextStyle(fontSize: 16)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
