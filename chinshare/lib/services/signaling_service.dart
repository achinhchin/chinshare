import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

typedef SignalingCallback = void Function(Map<String, dynamic> data);

class SignalingService {
  WebSocketChannel? _channel;
  final Map<String, SignalingCallback> _listeners = {};

  String? roomId;
  String? viewerId;
  String? role; // 'broadcaster' or 'viewer'

  void connect(String url) {
    print('Connecting to signaling server at $url...');
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));

      _channel!.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message);
            final type = data['type'] as String?;
            print('Received WS Message: $type');

            if (type != null && _listeners.containsKey(type)) {
              _listeners[type]!(data);
            }
          } catch (e) {
            print('Error parsing message: $e');
          }
        },
        onError: (error) {
          print('WebSocket Error: $error');
        },
        onDone: () {
          print('WebSocket Closed (Done)');
        },
        cancelOnError:
            false, // Don't cancel on error, to see if reconnect is needed
      );
      print('WebSocket connection initiated.');
    } catch (e) {
      print('Exception during connect: $e');
    }
  }

  void disconnect() {
    print('Disconnecting WebSocket...');
    _channel?.sink.close();
    _channel = null;
    roomId = null;
    viewerId = null;
    role = null;
  }

  void on(String event, SignalingCallback callback) {
    _listeners[event] = callback;
  }

  void off(String event) {
    _listeners.remove(event);
  }

  void send(String type, [Map<String, dynamic>? payload]) {
    if (_channel == null) {
      print('Cannot send message $type: Channel is null');
      return;
    }

    final data = <String, dynamic>{'type': type};
    if (payload != null) {
      data.addAll(payload);
    }

    final encoded = jsonEncode(data);
    print('Sending WS Message: $encoded');
    _channel!.sink.add(encoded);
  }

  void createRoom([String? code]) {
    role = 'broadcaster';
    if (code != null && code.length == 6) {
      send('create-room', {'roomId': code});
    } else {
      send('create-room');
    }
  }

  void joinRoom(String code) {
    role = 'viewer';
    send('join-room', {'roomId': code});
  }
}
