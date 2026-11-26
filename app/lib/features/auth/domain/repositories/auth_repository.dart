import '../../../../core/result/result.dart';
import '../entities/user.dart';

/// What the app needs from "authentication", without saying HOW.
/// The domain layer owns this contract; the data layer implements it (F3).
abstract interface class AuthRepository {
  Future<Result<User>> login({required String email, required String password});

  Future<Result<User>> register({
    required String name,
    required String email,
    required String password,
  });

  /// Restores the session from the tokens saved on the device.
  Future<Result<User>> currentUser();

  Future<void> logout();
}
