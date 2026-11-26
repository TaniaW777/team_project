import 'dart:developer';

import 'package:flutter_bloc/flutter_bloc.dart';

/// Sees every transition and error of every bloc (lab §3.11).
/// Logs state TYPES only: never the event payloads (passwords).
class AppBlocObserver extends BlocObserver {
  const AppBlocObserver();

  @override
  void onTransition(
    Bloc<dynamic, dynamic> bloc,
    Transition<dynamic, dynamic> transition,
  ) {
    super.onTransition(bloc, transition);
    log(
      '${transition.event.runtimeType}: '
      '${transition.currentState.runtimeType} -> '
      '${transition.nextState.runtimeType}',
      name: bloc.runtimeType.toString(),
    );
  }

  @override
  void onError(BlocBase<dynamic> bloc, Object error, StackTrace stackTrace) {
    log('$error', name: bloc.runtimeType.toString(), stackTrace: stackTrace);
    super.onError(bloc, error, stackTrace);
  }
}
