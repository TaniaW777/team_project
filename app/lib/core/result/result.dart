import '../error/failure.dart';

/// The outcome of an operation that can fail: either a value or a Failure.
/// Repositories return a Result instead of throwing, so the caller is forced
/// by the compiler to deal with the error case (lab §3.3, F3).
sealed class Result<T> {
  const Result();
}

final class Ok<T> extends Result<T> {
  const Ok(this.value);

  final T value;
}

final class Err<T> extends Result<T> {
  const Err(this.failure);

  final Failure failure;
}
