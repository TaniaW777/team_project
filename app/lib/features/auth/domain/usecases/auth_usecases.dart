import '../../../../core/result/result.dart';
import '../entities/user.dart';
import '../repositories/auth_repository.dart';

// One class = one thing the user can do (lab §3.5). The `call` method makes
// an instance usable like a function: await loginUser(email: ..., password: ...)

class LoginUser {
  const LoginUser(this._repository);

  final AuthRepository _repository;

  Future<Result<User>> call({required String email, required String password}) {
    return _repository.login(email: email.trim(), password: password);
  }
}

class RegisterUser {
  const RegisterUser(this._repository);

  final AuthRepository _repository;

  Future<Result<User>> call({
    required String name,
    required String email,
    required String password,
  }) {
    return _repository.register(
      name: name.trim(),
      email: email.trim(),
      password: password,
    );
  }
}

class GetCurrentUser {
  const GetCurrentUser(this._repository);

  final AuthRepository _repository;

  Future<Result<User>> call() => _repository.currentUser();
}

class LogoutUser {
  const LogoutUser(this._repository);

  final AuthRepository _repository;

  Future<void> call() => _repository.logout();
}
