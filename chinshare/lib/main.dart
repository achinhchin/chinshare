import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ChinShareApp());
}

class ChinShareApp extends StatelessWidget {
  const ChinShareApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ChinShare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.blue,
        scaffoldBackgroundColor: Colors.black,
        useMaterial3: true,
        fontFamily: 'SF Pro Text', // Fallback to system font if not available
      ),
      home: const HomeScreen(),
    );
  }
}
