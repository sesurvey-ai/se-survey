import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart' show AppVersion;

// ── Design tokens (from "SE Survey · Login Redesign" — Style B Minimal) ──
const Color _accent = Color(0xFF1D5BE0);
const Color _ink = Color(0xFF1A2236);
const Color _label = Color(0xFF6B7488);
const Color _muted = Color(0xFFAEB5C6);
const Color _line = Color(0xFFE6E9F0);
const Color _errorRed = Color(0xFFDC3848);

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _localError;
  // เลขเวอร์ชันอ่านจากตัวแอปเอง (pubspec → APK) — เดิมพิมพ์ตายตัว 'เวอร์ชัน 1.0.0' ไม่ตรงกับเครื่องจริง
  // ขยับเลขใน pubspec แล้วหน้านี้ตามเองทุกครั้ง ไม่ต้องแก้ที่นี่ (user สั่ง 03/10/69)
  String _version = '';

  @override
  void initState() {
    super.initState();
    AppVersion.get().then((v) {
      if (mounted) setState(() => _version = v.split('+').first);
    });
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    final auth = context.read<AuthProvider>();
    if (auth.isLoading) return;

    if (_usernameController.text.trim().isEmpty ||
        _passwordController.text.trim().isEmpty) {
      setState(() => _localError = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ครบถ้วน');
      return;
    }
    setState(() => _localError = null);
    await auth.login(
      _usernameController.text.trim(),
      _passwordController.text,
    );
  }

  void _clearError() {
    if (_localError != null) setState(() => _localError = null);
  }

  // ใช้ font default ของ Flutter (เหมือนหน้าอื่นทั้งแอป) — กำหนดแค่ขนาด/น้ำหนัก/สี
  TextStyle _head(double size, {FontWeight weight = FontWeight.w700, Color? color}) =>
      TextStyle(fontSize: size, fontWeight: weight, color: color ?? _ink);

  TextStyle _body(double size, {FontWeight weight = FontWeight.w400, Color? color}) =>
      TextStyle(fontSize: size, fontWeight: weight, color: color ?? _ink);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(30, 40, 30, 30),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Logo (full SE company logo, top-left)
                        Image.asset(
                          'assets/se-mark.png',
                          width: 150,
                          fit: BoxFit.contain,
                          filterQuality: FilterQuality.high,
                        ),
                        const SizedBox(height: 28),
                        // Heading
                        Text('เข้าสู่ระบบ', style: _head(28)),
                        const SizedBox(height: 42),
                        // Fields
                        _MinimalField(
                          label: 'ชื่อผู้ใช้',
                          icon: Icons.person_outline_rounded,
                          controller: _usernameController,
                          placeholder: 'กรอกชื่อผู้ใช้',
                          textInputAction: TextInputAction.next,
                          onChanged: (_) => _clearError(),
                          bodyStyle: _body(16),
                          labelStyle: _body(13, weight: FontWeight.w500, color: _label),
                        ),
                        const SizedBox(height: 26),
                        _MinimalField(
                          label: 'รหัสผ่าน',
                          icon: Icons.lock_outline_rounded,
                          controller: _passwordController,
                          placeholder: 'กรอกรหัสผ่าน',
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onChanged: (_) => _clearError(),
                          onSubmitted: (_) => _handleLogin(),
                          bodyStyle: _body(16),
                          labelStyle: _body(13, weight: FontWeight.w500, color: _label),
                          trailing: GestureDetector(
                            onTap: () => setState(() => _obscurePassword = !_obscurePassword),
                            child: Padding(
                              padding: const EdgeInsets.all(4),
                              child: Icon(
                                _obscurePassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                                size: 20,
                                color: const Color(0xFF9AA3B8),
                              ),
                            ),
                          ),
                        ),
                        // Error note
                        Consumer<AuthProvider>(
                          builder: (context, auth, _) {
                            final msg = _localError ?? auth.error;
                            if (msg == null) return const SizedBox(height: 26);
                            return Padding(
                              padding: const EdgeInsets.only(top: 18),
                              child: Row(
                                children: [
                                  const Icon(Icons.error_outline,
                                      size: 16, color: _errorRed),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(msg,
                                        style: _body(13, color: _errorRed)),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 26),
                        // Forgot password (right-aligned)
                        Align(
                          alignment: Alignment.centerRight,
                          child: GestureDetector(
                            onTap: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัสผ่าน'),
                                ),
                              );
                            },
                            child: Text('ลืมรหัสผ่าน?',
                                style: _body(14,
                                    weight: FontWeight.w500, color: _accent)),
                          ),
                        ),
                        // Bottom: button + version
                        const Spacer(),
                        const SizedBox(height: 34),
                        Consumer<AuthProvider>(
                          builder: (context, auth, _) =>
                              _primaryButton(auth.isLoading),
                        ),
                        const SizedBox(height: 20),
                        Center(
                          child: Text(_version.isEmpty ? '' : 'เวอร์ชัน $_version',
                              style: _body(12.5, color: _muted)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _primaryButton(bool loading) {
    return SizedBox(
      width: double.infinity,
      height: 54,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: _accent.withValues(alpha: 0.33),
              blurRadius: 22,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ElevatedButton(
          onPressed: loading ? null : _handleLogin,
          style: ElevatedButton.styleFrom(
            backgroundColor: _accent,
            disabledBackgroundColor: _accent.withValues(alpha: 0.92),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          child: loading
              ? const SizedBox(
                  width: 21,
                  height: 21,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.6,
                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('เข้าสู่ระบบ',
                        style: _head(16, weight: FontWeight.w600, color: Colors.white)),
                    const SizedBox(width: 9),
                    const Icon(Icons.arrow_forward_rounded, size: 18),
                  ],
                ),
        ),
      ),
    );
  }
}

// ── Underline field with focus-aware accent ──
class _MinimalField extends StatefulWidget {
  const _MinimalField({
    required this.label,
    required this.icon,
    required this.controller,
    required this.placeholder,
    required this.bodyStyle,
    required this.labelStyle,
    this.obscureText = false,
    this.trailing,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction,
  });

  final String label;
  final IconData icon;
  final TextEditingController controller;
  final String placeholder;
  final TextStyle bodyStyle;
  final TextStyle labelStyle;
  final bool obscureText;
  final Widget? trailing;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;

  @override
  State<_MinimalField> createState() => _MinimalFieldState();
}

class _MinimalFieldState extends State<_MinimalField> {
  final FocusNode _focusNode = FocusNode();
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() {
      if (_focusNode.hasFocus != _focused) {
        setState(() => _focused = _focusNode.hasFocus);
      }
    });
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final activeColor = _focused ? _accent : _line;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.label, style: widget.labelStyle),
        const SizedBox(height: 9),
        AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.only(left: 2, right: 2, bottom: 11),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: activeColor, width: 2),
            ),
          ),
          child: Row(
            children: [
              Icon(widget.icon,
                  size: 19, color: _focused ? _accent : _muted),
              const SizedBox(width: 11),
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _focusNode,
                  obscureText: widget.obscureText,
                  onChanged: widget.onChanged,
                  onSubmitted: widget.onSubmitted,
                  textInputAction: widget.textInputAction,
                  cursorColor: _accent,
                  style: widget.bodyStyle,
                  decoration: InputDecoration(
                    isCollapsed: true,
                    border: InputBorder.none,
                    hintText: widget.placeholder,
                    hintStyle: widget.bodyStyle.copyWith(color: const Color(0xFFAAB2C4)),
                  ),
                ),
              ),
              if (widget.trailing != null) widget.trailing!,
            ],
          ),
        ),
      ],
    );
  }
}
