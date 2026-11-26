import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failure.dart';
import '../bloc/auth_bloc.dart';

/// Lab appendix A (starter widget). Client validation mirrors the API rules
/// (name 2-80, valid e-mail, password 8-128); server 422 messages are shown
/// next to the fields (F10).
class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    context.read<AuthBloc>().add(
      AuthRegisterRequested(
        name: _name.text,
        email: _email.text,
        password: _password.text,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create an EventPass account')),
      body: BlocConsumer<AuthBloc, AuthState>(
        listenWhen: (previous, current) =>
            current is Unauthenticated && current.failure != null,
        listener: (context, state) {
          final failure = (state as Unauthenticated).failure!;
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text(failure.message)));
        },
        builder: (context, state) {
          final loading = state is AuthLoading;
          // Show the per-field messages sent back by the API (422).
          final serverErrors = switch (state) {
            Unauthenticated(failure: ValidationFailure(:final fieldErrors)) =>
              fieldErrors,
            _ => const <String, String>{},
          };
          return Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                TextFormField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: 'Name',
                    errorText: serverErrors['name'],
                  ),
                  validator: (value) =>
                      value != null && value.trim().length >= 2
                      ? null
                      : 'Enter your name',
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    labelText: 'Email',
                    errorText: serverErrors['email'],
                  ),
                  validator: (value) => value != null && value.contains('@')
                      ? null
                      : 'Enter a valid email',
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: 'Password (8 characters minimum)',
                    errorText: serverErrors['password'],
                  ),
                  validator: (value) =>
                      value != null && value.length >= 8 && value.length <= 128
                      ? null
                      : 'Between 8 and 128 characters',
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: loading ? null : _submit,
                  child: loading
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Create account'),
                ),
                TextButton(
                  onPressed: loading ? null : () => context.go('/login'),
                  child: const Text('Already registered? Sign in'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
