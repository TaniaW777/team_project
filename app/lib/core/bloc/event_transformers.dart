import 'dart:async';

import 'package:bloc_concurrency/bloc_concurrency.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

/// Debounce + restartable (F8, deliberate transformer), for search boxes:
///
/// * debounce: wait until the user has stopped typing for [duration] and keep
///   only the LAST event, so typing "music" sends one request, not five;
/// * restartable: if a new search starts while the previous request is still
///   running, the previous handler is cancelled and its result is ignored,
///   so an old, slow answer can never overwrite a newer one.
EventTransformer<E> debounceRestartable<E>(Duration duration) {
  return (events, mapper) =>
      restartable<E>().call(debounce(events, duration), mapper);
}

/// Emits an event from [source] only after [duration] without a newer one.
Stream<E> debounce<E>(Stream<E> source, Duration duration) {
  late final StreamController<E> controller;
  StreamSubscription<E>? subscription;
  Timer? timer;

  controller = StreamController<E>(
    onListen: () {
      subscription = source.listen(
        (event) {
          timer?.cancel(); // a newer event replaces the waiting one
          timer = Timer(duration, () => controller.add(event));
        },
        onError: controller.addError,
        onDone: () {
          timer?.cancel();
          controller.close();
        },
      );
    },
    onCancel: () {
      timer?.cancel();
      return subscription?.cancel();
    },
  );
  return controller.stream;
}
