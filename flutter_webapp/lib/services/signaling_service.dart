import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:async';

typedef SignalingCallback = void Function(Map<String, dynamic> data);

class SignalingService {
  WebSocketChannel? _channel;
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  String? url;

  Stream<Map<String, dynamic>> get onMessage => _messageController.stream;

  void connect(String newUrl) {
    if (_channel != null && url == newUrl) return;
    if (_channel != null) disconnect();
    url = newUrl;
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url!));
      _channel!.stream.listen(
        (data) {
          final decoded = json.decode(data);
          _messageController.add(decoded);
        },
        onError: (error) => print('WebSocket error: $error'),
        onDone: () => print('WebSocket closed'),
      );
      print('Connected to Signaling Server at $url');
    } catch (e) {
      print('WebSocket connection failed: $e');
    }
  }

  void send(Map<String, dynamic> data) {
    if (_channel != null) {
      _channel!.sink.add(json.encode(data));
    } else {
      print('Cannot send message: WebSocket not connected');
    }
  }

  void createRoom(String? roomId) {
    send({
      'type': 'create-room',
      if (roomId != null) 'roomId': roomId,
    });
  }

  void joinRoom(String roomId) {
    send({
      'type': 'join-room',
      'roomId': roomId,
    });
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
  }

  void dispose() {
    disconnect();
    _messageController.close();
  }
}
