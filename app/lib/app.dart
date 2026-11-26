import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'core/router/app_router.dart';
import 'features/auth/presentation/bloc/auth_bloc.dart';

class EventPassApp extends StatefulWidget {
  const EventPassApp({super.key});

  @override
  State<EventPassApp> createState() => _EventPassAppState();
}

class _EventPassAppState extends State<EventPassApp> {
  // Created once: rebuilding the router would reset the navigation.
  late final _router = createRouter(context.read<AuthBloc>());

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'EventPass',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF1F6FEB),
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      routerConfig: _router,
    );
  }
}

/// Shown instead of the app when it was built without API_BASE_URL (F13):
/// fail visibly rather than calling a guessed address.
class MissingConfigurationApp extends StatelessWidget {
  const MissingConfigurationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'API_BASE_URL is not set.\n\nStart the app with\n'
              'flutter run --dart-define=API_BASE_URL=<api url>/api/v1',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
