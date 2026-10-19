import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

// The store tablet is a production-only client. Keep safe production defaults
// so a plain `flutter build apk` cannot silently produce an app that renders
// its UI but is unable to call employee/QR/short-term worker APIs. Both values
// are public client configuration; --dart-define can still override them for
// local or staging builds.
const supabaseUrl = String.fromEnvironment(
  'SUPABASE_URL',
  defaultValue: 'https://xzcvgxnhospcedeebnsf.supabase.co',
);
const supabasePublishableKey = String.fromEnvironment(
  'SUPABASE_ANON_KEY',
  defaultValue: 'sb_publishable__oqmG_YzWpQGtm-RZRWIVQ_Ji1JtHLH',
);
const mobileAppUrl = String.fromEnvironment(
  'MOBILE_APP_URL',
  defaultValue: 'https://timefit-mobile.vercel.app/',
);
const tabletApiBaseUrl = String.fromEnvironment(
  'TABLET_API_BASE_URL',
  defaultValue: 'https://timefit-omega.vercel.app',
);

String mobileAttendanceQrUrl(String qrToken) {
  final base = Uri.parse(mobileAppUrl);
  return base.replace(
    queryParameters: {...base.queryParameters, 'qr': qrToken},
    fragment: 'attendance',
  ).toString();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty) {
    await Supabase.initialize(
      url: supabaseUrl,
      publishableKey: supabasePublishableKey,
    );
  }
  runApp(const TimeFitTabletApp());
}

class TimeFitTabletApp extends StatelessWidget {
  const TimeFitTabletApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff3182f6)),
        scaffoldBackgroundColor: const Color(0xfff6f9fc),
        useMaterial3: true,
        filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(64),
                backgroundColor: const Color(0xff3182f6),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
                textStyle: const TextStyle(
                    fontSize: 17, fontWeight: FontWeight.bold))),
      ),
      home: const TabletShell());
}

class TabletShell extends StatefulWidget {
  const TabletShell({super.key});
  @override
  State<TabletShell> createState() => _TabletShellState();
}

class _TabletShellState extends State<TabletShell> {
  final pin = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final attendancePhone = TextEditingController();
  final attendancePhoneLast8 = TextEditingController();
  final leavePhone = TextEditingController();
  final dailyName = TextEditingController();
  final dailyResident = TextEditingController();
  final dailyPhone = TextEditingController();
  final date = TextEditingController();
  final emailFocus = FocusNode();
  final passwordFocus = FocusNode();
  final phoneFocus = FocusNode();
  String? token;
  String mode = 'setup';
  bool loadingDeviceSession = true;
  bool deviceSessionReady = false;
  bool busy = false;
  String? notice;
  String? employee;
  String? action;
  String? attendanceStaffId;
  String? qrToken;
  String? qrOrganizationName;
  String? qrError;
  bool qrLoading = false;
  String leaveType = '연차';
  String dailyAction = 'check_in';
  bool dailyPrivacyConsent = false;
  Timer? dailyIdleTimer;
  @override
  void initState() {
    super.initState();
    dailyName.addListener(_scheduleDailyPrivacyReset);
    dailyResident.addListener(_scheduleDailyPrivacyReset);
    dailyPhone.addListener(_scheduleDailyPrivacyReset);
    _load();
  }

  @override
  void dispose() {
    dailyIdleTimer?.cancel();
    dailyName.dispose();
    dailyResident.dispose();
    dailyPhone.dispose();
    super.dispose();
  }

  void _scheduleDailyPrivacyReset() {
    dailyIdleTimer?.cancel();
    if (dailyName.text.isEmpty &&
        dailyResident.text.isEmpty &&
        dailyPhone.text.isEmpty) return;
    dailyIdleTimer = Timer(const Duration(minutes: 2), () {
      if (mounted) _resetDailyWorkerForm();
    });
  }

  void _resetDailyWorkerForm({String? action}) {
    dailyIdleTimer?.cancel();
    dailyName.clear();
    dailyResident.clear();
    dailyPhone.clear();
    if (!mounted) return;
    setState(() {
      dailyAction = action ?? dailyAction;
      dailyPrivacyConsent = false;
    });
  }

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    final savedToken = p.getString('device_token');
    if (!mounted) return;
    setState(() {
      token = savedToken;
      deviceSessionReady = savedToken != null && savedToken.isNotEmpty;
      mode = deviceSessionReady ? 'attendance' : 'setup';
      loadingDeviceSession = false;
    });
  }

  Future<T> _withNetworkRetry<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on TimeoutException {
      await Future<void>.delayed(const Duration(milliseconds: 700));
      return request();
    }
  }

  Future<void> _disconnectTablet() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove('device_token');
    await Supabase.instance.client.auth.signOut().catchError((_) {});
    if (!mounted) return;
    setState(() {
      token = null;
      loadingDeviceSession = false;
      deviceSessionReady = false;
      mode = 'setup';
      employee = null;
      action = null;
      attendanceStaffId = null;
      qrToken = null;
      qrOrganizationName = null;
      qrError = null;
      qrLoading = false;
      attendancePhone.clear();
      attendancePhoneLast8.clear();
      leavePhone.clear();
      dailyName.clear();
      dailyResident.clear();
      dailyPhone.clear();
      dailyPrivacyConsent = false;
      dailyAction = 'check_in';
      date.clear();
      email.clear();
      password.clear();
      notice = '관리자 로그아웃이 완료됐어요. 다른 사업장으로 다시 연결할 수 있어요.';
    });
  }

  Future<void> _selectMode(String nextMode) async {
    if (mode == 'daily' && nextMode != 'daily') _resetDailyWorkerForm();
    setState(() => mode = nextMode);
    if (nextMode == 'qr' && qrToken == null && !qrLoading) {
      await _loadAttendanceQr();
    }
  }

  Future<void> _loadAttendanceQr() async {
    if (token == null || token!.isEmpty) return;
    setState(() {
      qrLoading = true;
      qrError = null;
    });
    try {
      final response = await _withNetworkRetry(() => Supabase.instance.client
              .rpc('timefit_user_tablet_static_attendance_qr', params: {
            'p_device_token': token,
          }).timeout(const Duration(seconds: 12)));
      final result = Map<String, dynamic>.from(response as Map);
      final nextToken = result['token']?.toString();
      if (nextToken == null || nextToken.isEmpty) {
        throw Exception('qr_token_missing');
      }
      if (!mounted) return;
      setState(() {
        qrToken = nextToken;
        qrOrganizationName = result['organizationName']?.toString();
      });
    } on TimeoutException {
      if (mounted) {
        setState(() => qrError = 'QR을 불러오는 시간이 초과됐어요. 인터넷 연결을 확인해 주세요.');
      }
    } catch (error) {
      if (!mounted) return;
      final detail = error.toString();
      setState(() {
        qrError = detail.contains('tablet_device_not_active')
            ? '태블릿 연결이 만료됐어요. 관리자 연결을 다시 진행해 주세요.'
            : detail.contains('tablet_access_denied')
                ? '관리자가 태블릿 사용을 활성화해 주세요.'
                : '업장 QR을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      });
    } finally {
      if (mounted) setState(() => qrLoading = false);
    }
  }

  Future<void> _activate() async {
    FocusScope.of(context).unfocus();
    if (supabaseUrl.isEmpty) return _show('Supabase 환경 변수를 설정해 주세요.');
    if (email.text.trim().isEmpty || password.text.isEmpty)
      return _show('관리자 이메일과 비밀번호를 입력해 주세요.');
    setState(() => busy = true);
    try {
      final auth = Supabase.instance.client;
      await _withNetworkRetry(() => auth.auth
          .signInWithPassword(
              email: email.text.trim().toLowerCase(), password: password.text)
          .timeout(const Duration(seconds: 12)));
      final membership = await _withNetworkRetry(() => auth
          .rpc('timefit_user_get_manager_tablet_organization')
          .timeout(const Duration(seconds: 12)));
      final orgId =
          membership['organizationId'] ?? membership['organization_id'];
      if (orgId == null) throw Exception('manager_organization_not_found');
      final result = await _withNetworkRetry(
          () => auth.rpc('timefit_user_activate_tablet_device', params: {
                'p_organization_id': orgId,
                'p_display_name': '매장 태블릿',
                'p_metadata': {'native': true}
              }).timeout(const Duration(seconds: 12)));
      final deviceToken = result['deviceToken'] ?? result['device_token'];
      if (deviceToken == null) throw Exception('device_token_missing');
      final p = await SharedPreferences.getInstance();
      await p.setString('device_token', deviceToken as String);
      await auth.auth.signOut();
      if (!mounted) return;
      setState(() {
        token = deviceToken;
        deviceSessionReady = true;
        mode = 'attendance';
        notice = '관리자 인증과 태블릿 연결이 완료됐어요.';
      });
    } on TimeoutException {
      await Supabase.instance.client.auth.signOut().catchError((_) {});
      _show('태블릿 연결 시간이 초과됐어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    } catch (e) {
      await Supabase.instance.client.auth.signOut().catchError((_) {});
      final detail = e.toString().replaceFirst('Exception: ', '');
      _show(detail.contains('Invalid login credentials')
          ? '관리자 이메일 또는 비밀번호가 올바르지 않습니다. 웹 관리자 로그인과 동일한 계정을 사용해 주세요.'
          : '태블릿 연결 실패: $detail');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _lookup() async {
    if (attendancePhone.text.length != 4) return _show('전화번호 뒤 4자리를 입력해 주세요.');
    setState(() => busy = true);
    try {
      final response = await _withNetworkRetry(() => Supabase.instance.client
              .rpc('timefit_user_tablet_attendance_v3', params: {
            'p_device_token': token,
            'p_phone_last4': attendancePhone.text,
            'p_action': 'lookup',
            'p_staff_id': null,
            'p_phone_last8': null,
          }).timeout(const Duration(seconds: 12)));
      final result = Map<String, dynamic>.from(response as Map);
      if (result['requiresPhoneLast8'] == true) {
        final candidates = (result['candidates'] as List? ?? const [])
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        if (!mounted) return;
        setState(() => busy = false);
        return _showDuplicateEmployeePicker(candidates);
      }
      final name = result['employeeName']?.toString();
      final nextAction = result['nextAction']?.toString();
      if (name == null || nextAction == null)
        throw Exception('employee_lookup_invalid_response');
      if (!mounted) return;
      setState(() {
        employee = name;
        action = nextAction;
        // A unique last-4 match does not require the extra last-8 challenge.
        attendanceStaffId = null;
        busy = false;
      });
      _showEmployeeConfirmation('attendance');
    } on TimeoutException {
      if (mounted) _show('직원 확인 시간이 초과됐어요. 인터넷 연결 후 다시 시도해 주세요.');
    } catch (e) {
      if (mounted) _show(_lookupErrorMessage(e));
    } finally {
      if (mounted && busy) setState(() => busy = false);
    }
  }

  Future<void> _showDuplicateEmployeePicker(
      List<Map<String, dynamic>> candidates) async {
    String? selectedStaffId;
    attendancePhoneLast8.clear();
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('직원을 선택해 주세요'),
          content: SizedBox(
            width: 440,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text(
                  '같은 전화번호 뒤 4자리를 사용하는 직원이 있어요. 본인을 선택한 뒤 전화번호 뒤 8자리를 입력해 주세요.'),
              const SizedBox(height: 16),
              ...candidates.map((candidate) => RadioListTile<String>(
                    value: candidate['staffId'].toString(),
                    groupValue: selectedStaffId,
                    title: Text(candidate['employeeName']?.toString() ?? '직원'),
                    subtitle:
                        Text(candidate['department']?.toString() ?? '미분류'),
                    onChanged: (value) =>
                        setDialogState(() => selectedStaffId = value),
                  )),
              const SizedBox(height: 8),
              TextField(
                controller: attendancePhoneLast8,
                keyboardType: TextInputType.number,
                maxLength: 8,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(
                    labelText: '전화번호 뒤 8자리',
                    hintText: '예: 12345678',
                    border: OutlineInputBorder()),
              ),
            ]),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('취소')),
            FilledButton(
              onPressed: () async {
                if (selectedStaffId == null ||
                    attendancePhoneLast8.text.length != 8) {
                  _show('직원을 선택하고 전화번호 뒤 8자리를 입력해 주세요.');
                  return;
                }
                try {
                  final response = await _withNetworkRetry(() => Supabase
                          .instance.client
                          .rpc('timefit_user_tablet_attendance_v3', params: {
                        'p_device_token': token,
                        'p_phone_last4': attendancePhone.text,
                        'p_action': 'lookup',
                        'p_staff_id': selectedStaffId,
                        'p_phone_last8': attendancePhoneLast8.text,
                      }).timeout(const Duration(seconds: 12)));
                  final result = Map<String, dynamic>.from(response as Map);
                  if (!mounted) return;
                  setState(() {
                    employee = result['employeeName']?.toString();
                    action = result['nextAction']?.toString();
                    attendanceStaffId = selectedStaffId;
                  });
                  if (dialogContext.mounted) Navigator.pop(dialogContext);
                  _showEmployeeConfirmation('attendance');
                } catch (error) {
                  _show(_lookupErrorMessage(error));
                }
              },
              child: const Text('직원 확인'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _lookupLeave() async {
    if (leavePhone.text.length != 8 || date.text.isEmpty)
      return _show('전화번호와 휴가 날짜를 확인해 주세요.');
    setState(() => busy = true);
    try {
      final response = await Supabase.instance.client
          // 휴가 신청은 출퇴근 조회 RPC가 아닌, 날짜·휴가 유형까지 검증하는 전용 미리보기 RPC를 사용합니다.
          .rpc('timefit_user_tablet_leave_preview_v3', params: {
        'p_device_token': token,
        'p_phone_last8': leavePhone.text,
        'p_starts_on': date.text,
        'p_ends_on': date.text,
        'p_leave_type': leaveType,
      }).timeout(const Duration(seconds: 12));
      final result = Map<String, dynamic>.from(response as Map);
      final name = result['employeeName']?.toString();
      if (name == null) throw Exception('employee_lookup_invalid_response');
      if (!mounted) return;
      setState(() {
        employee = name;
        busy = false;
      });
      _showEmployeeConfirmation('leave');
    } on TimeoutException {
      if (mounted) _show('직원 확인 시간이 초과됐어요. 인터넷 연결 후 다시 시도해 주세요.');
    } catch (e) {
      if (mounted) _show(_lookupErrorMessage(e));
    } finally {
      if (mounted && busy) setState(() => busy = false);
    }
  }

  String _lookupErrorMessage(Object error) {
    final detail = error.toString();
    if (detail.contains('tablet_device_not_active'))
      return '태블릿 연결이 만료됐어요. 관리자 연결을 다시 진행해 주세요.';
    if (detail.contains('tablet_access_denied'))
      return '관리자가 태블릿 출퇴근을 활성화해 주세요.';
    if (detail.contains('employee_not_found'))
      return '등록된 직원 정보를 찾지 못했어요. 전화번호를 다시 확인해 주세요.';
    if (detail.contains('phone_last8_mismatch'))
      return '선택한 직원의 전화번호 뒤 8자리가 일치하지 않아요.';
    if (detail.contains('phone_last8_required')) return '전화번호 뒤 8자리를 입력해 주세요.';
    return '직원 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }

  void _showEmployeeConfirmation(String flow) {
    final isAttendance = flow == 'attendance';
    final actionLabel = action == 'check_in' ? '출근' : '퇴근';
    showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: '직원 확인',
      barrierColor: const Color(0xA60F172A),
      transitionDuration: const Duration(milliseconds: 240),
      pageBuilder: (dialogContext, _, __) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.fromLTRB(36, 34, 36, 28),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(30),
                boxShadow: const [
                  BoxShadow(
                      color: Color(0x3D0F172A),
                      blurRadius: 42,
                      offset: Offset(0, 18))
                ],
              ),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                    width: 68,
                    height: 68,
                    decoration: const BoxDecoration(
                        color: Color(0xffe8f2ff), shape: BoxShape.circle),
                    child: const Icon(Icons.verified_rounded,
                        color: Color(0xff3182f6), size: 38)),
                const SizedBox(height: 20),
                const Text('직원을 확인해 주세요',
                    style: TextStyle(
                        fontSize: 16,
                        color: Color(0xff6b7684),
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text('$employee님이 맞나요?',
                    style: const TextStyle(
                        fontSize: 26,
                        color: Color(0xff191f28),
                        fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                Text(
                    isAttendance
                        ? '완료하면 $actionLabel 기록이 바로 저장돼요.'
                        : '완료하면 휴가 신청이 관리자에게 전달돼요.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        fontSize: 16, color: Color(0xff6b7684), height: 1.5)),
                const SizedBox(height: 28),
                Row(children: [
                  Expanded(
                      child: OutlinedButton(
                          onPressed: () {
                            setState(() => employee = null);
                            Navigator.pop(dialogContext);
                          },
                          style: OutlinedButton.styleFrom(
                              minimumSize: const Size(0, 58),
                              side: const BorderSide(color: Color(0xffdfe5ec)),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16))),
                          child: const Text('다시 입력'))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: FilledButton(
                          onPressed: () async {
                            Navigator.pop(dialogContext);
                            if (isAttendance) {
                              await _saveAttendance();
                            } else {
                              await _saveLeave();
                            }
                          },
                          style: FilledButton.styleFrom(
                              minimumSize: const Size(0, 58)),
                          child: const Text('완료'))),
                ]),
              ]),
            ),
          ),
        ),
      ),
      transitionBuilder: (_, animation, __, child) => FadeTransition(
          opacity: animation,
          child: ScaleTransition(
              scale: Tween<double>(begin: .92, end: 1).animate(CurvedAnimation(
                  parent: animation, curve: Curves.easeOutBack)),
              child: child)),
    );
  }

  String _saveErrorMessage(Object error, {required bool leave}) {
    final detail = error.toString();
    if (detail.contains('already_checked_in')) return '오늘은 이미 출근 처리됐어요.';
    if (detail.contains('already_checked_out')) return '오늘은 이미 퇴근 처리됐어요.';
    if (detail.contains('check_in_required')) return '출근 기록이 없어 퇴근 처리할 수 없어요.';
    if (detail.contains('tablet_device_not_active'))
      return '태블릿 연결이 만료됐어요. 관리자 연결을 다시 진행해 주세요.';
    if (detail.contains('tablet_access_denied'))
      return '관리자가 태블릿 출퇴근을 활성화해 주세요.';
    if (detail.contains('employee_not_found')) return '등록된 직원 정보를 찾지 못했어요.';
    if (detail.contains('holiday_leave_not_allowed'))
      return '선택한 날짜는 휴가 차감 대상이 아니에요.';
    if (detail.contains('invalid_payload'))
      return leave ? '휴가 날짜·유형·전화번호를 다시 확인해 주세요.' : '출퇴근 정보를 다시 확인해 주세요.';
    if (detail.contains('permission denied') || detail.contains('42501'))
      return '저장 권한이 없어요. 관리자에게 태블릿 설정을 확인해 달라고 요청해 주세요.';
    return leave
        ? '휴가 신청 저장에 실패했어요. 오류 코드: ${detail.length > 70 ? detail.substring(0, 70) : detail}'
        : '출퇴근 저장에 실패했어요. 오류 코드: ${detail.length > 70 ? detail.substring(0, 70) : detail}';
  }

  Future<void> _saveAttendance() async {
    if (employee == null || action == null) return;
    setState(() => busy = true);
    try {
      final result = await Supabase.instance.client
          .rpc('timefit_user_tablet_attendance_v3', params: {
        'p_device_token': token,
        'p_phone_last4': attendancePhone.text,
        'p_action': action,
        'p_staff_id': attendanceStaffId,
        'p_phone_last8':
            attendanceStaffId == null ? null : attendancePhoneLast8.text,
      }).timeout(const Duration(seconds: 12));
      _show(
          '${result['employeeName']}님 ${action == 'check_in' ? '출근' : '퇴근'} 기록을 저장했어요.');
      setState(() {
        employee = null;
        attendanceStaffId = null;
        attendancePhone.clear();
        attendancePhoneLast8.clear();
      });
    } on TimeoutException {
      _show('출퇴근 저장 시간이 초과됐어요. 인터넷 연결 후 다시 시도해 주세요.');
    } catch (e) {
      _show(_saveErrorMessage(e, leave: false));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _saveLeave() async {
    if (leavePhone.text.length != 8 || date.text.isEmpty)
      return _show('전화번호와 휴가 날짜를 확인해 주세요.');
    setState(() => busy = true);
    try {
      final result = await _withNetworkRetry(() => Supabase.instance.client
              .rpc('timefit_user_tablet_leave_request_v2', params: {
            'p_device_token': token,
            'p_phone_last8': leavePhone.text,
            'p_starts_on': date.text,
            'p_ends_on': date.text,
            'p_leave_type': leaveType
          }).timeout(const Duration(seconds: 12)));
      _show('${result['employeeName']}님 휴가 신청이 완료됐어요.');
      setState(() {
        leavePhone.clear();
        date.clear();
      });
    } on TimeoutException {
      _show('휴가 신청 저장 시간이 초과됐어요. 인터넷 연결 후 다시 시도해 주세요.');
    } catch (e) {
      _show(_saveErrorMessage(e, leave: true));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String _dailyRequestKey() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex =
        bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  String _maskedDailyPhone(String value) {
    if (value.length < 8) return value;
    return '${value.substring(0, 3)}-${List.filled(value.length - 7, '*').join()}-${value.substring(value.length - 4)}';
  }

  String _maskedDailyResident(String value) => value.length == 13
      ? '${value.substring(0, 6)}-${value.substring(6, 7)}******'
      : '';

  String _dailyAttendanceTime(dynamic value) {
    if (value == null || value.toString().isEmpty) return '-';
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return '-';
    final korea = parsed.toUtc().add(const Duration(hours: 9));
    return '${korea.hour.toString().padLeft(2, '0')}:${korea.minute.toString().padLeft(2, '0')}';
  }

  String _dailyAttendanceDate(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    if (parsed == null) return '-';
    const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
    return '${parsed.year}년 ${parsed.month}월 ${parsed.day}일 (${weekdays[parsed.weekday - 1]})';
  }

  String _dailyWorkedTime(dynamic checkedInAt, dynamic checkedOutAt) {
    if (checkedInAt == null || checkedOutAt == null) return '근무 중';
    final start = DateTime.tryParse(checkedInAt.toString());
    final end = DateTime.tryParse(checkedOutAt.toString());
    if (start == null || end == null) return '-';
    final minutes = end.difference(start).inMinutes.clamp(0, 99999);
    if (minutes < 60) return '$minutes분';
    final remainder = minutes % 60;
    return '${minutes ~/ 60}시간${remainder > 0 ? ' $remainder분' : ''}';
  }

  String _dailyWorkerErrorMessage(Object error) {
    final detail = error.toString();
    if (detail.contains('daily_worker_invalid_phone'))
      return '휴대전화 번호를 010부터 정확히 입력해 주세요.';
    if (detail.contains('daily_worker_invalid_resident'))
      return '주민등록번호와 생년월일을 다시 확인해 주세요.';
    if (detail.contains('daily_worker_invalid_name'))
      return '이름은 2자 이상 입력해 주세요.';
    if (detail.contains('daily_worker_privacy_consent_required'))
      return '개인정보 수집·이용 동의가 필요합니다.';
    if (detail.contains('daily_worker_identity_conflict'))
      return '기존 등록 정보와 일치하지 않습니다. 관리자에게 문의해 주세요.';
    if (detail.contains('daily_worker_already_checked_in'))
      return '이미 출근 등록이 완료됐습니다.';
    if (detail.contains('daily_worker_already_checked_out'))
      return '오늘의 퇴근 등록이 이미 완료됐습니다.';
    if (detail.contains('daily_worker_open_attendance_not_found'))
      return '퇴근할 출근 기록을 찾지 못했습니다. 전화번호를 확인해 주세요.';
    if (detail.contains('daily_worker_additional_verification_required'))
      return '같은 전화번호로 여러 근로자가 확인됩니다. 관리자에게 문의해 주세요.';
    if (detail.contains('tablet_device_not_active'))
      return '태블릿 연결이 만료됐습니다. 관리자 연결이 필요합니다.';
    if (detail.contains('tablet_access_denied'))
      return '이 사업장의 태블릿 출퇴근 기능이 비활성화되어 있습니다.';
    if (detail.contains('daily_worker_secure_storage_unavailable'))
      return '보안 저장 설정을 확인하는 중입니다. 관리자에게 문의해 주세요.';
    return '단기직원 출퇴근 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }

  Future<Map<String, dynamic>> _postDailyWorker(
      Map<String, dynamic> payload) async {
    final client = HttpClient();
    try {
      final base = Uri.parse(tabletApiBaseUrl);
      final uri = base.replace(
          path: '/api/daily-worker-attendance', query: null, fragment: null);
      final request =
          await client.postUrl(uri).timeout(const Duration(seconds: 12));
      request.headers.contentType = ContentType.json;
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
      request.write(jsonEncode(payload));
      final response =
          await request.close().timeout(const Duration(seconds: 15));
      final text = await utf8.decoder.bind(response).join();
      final result = text.isEmpty
          ? <String, dynamic>{}
          : Map<String, dynamic>.from(jsonDecode(text) as Map);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['ok'] != true) {
        throw Exception(result['error']?.toString() ?? 'daily_worker_failed');
      }
      return Map<String, dynamic>.from(result['data'] as Map);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _saveDailyWorker({
    required String action,
    required String requestKey,
    required String name,
    required String resident,
    required String phone,
  }) async {
    setState(() => busy = true);
    try {
      final result = await _postDailyWorker({
        'action': action,
        'deviceToken': token,
        'requestKey': requestKey,
        'phone': phone,
        if (action == 'check_in') ...{
          'name': name,
          'residentRegistrationNumber': resident,
          'privacyConsent': true,
        }
      });
      final employeeName = result['employeeName']?.toString() ?? name;
      final reviewRequired = result['action'] == 'review_required';
      final workDate = _dailyAttendanceDate(result['workDate']);
      final checkedInAt = _dailyAttendanceTime(result['checkedInAt']);
      final checkedOutAt = _dailyAttendanceTime(result['checkedOutAt']);
      final workedTime = reviewRequired
          ? '관리자 확인 필요'
          : _dailyWorkedTime(result['checkedInAt'], result['checkedOutAt']);
      _resetDailyWorkerForm(action: action);
      _show(reviewRequired
          ? '$employeeName님의 이전 출근 기록은 관리자의 확인이 필요합니다.\n\n날짜  $workDate\n출근  $checkedInAt\n퇴근  $checkedOutAt\n근무시간  $workedTime'
          : '$employeeName님 ${action == 'check_in' ? '출근' : '퇴근'} 등록이 완료됐습니다.\n\n날짜  $workDate\n출근  $checkedInAt\n퇴근  $checkedOutAt\n근무시간  $workedTime');
    } on TimeoutException {
      _show('서버 응답이 지연되고 있습니다. 같은 화면에서 다시 시도해 주세요.');
    } catch (error) {
      _show(_dailyWorkerErrorMessage(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _confirmDailyWorker() async {
    FocusScope.of(context).unfocus();
    final action = dailyAction;
    final name = dailyName.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    final resident = dailyResident.text;
    final phone = dailyPhone.text;
    if (!RegExp(r'^01[016789][0-9]{7,8}$').hasMatch(phone))
      return _show('휴대전화 번호를 010부터 정확히 입력해 주세요.');
    if (action == 'check_in') {
      if (name.length < 2) return _show('이름은 2자 이상 입력해 주세요.');
      if (!RegExp(r'^[0-9]{13}$').hasMatch(resident))
        return _show('주민등록번호 13자리를 입력해 주세요.');
      if (!dailyPrivacyConsent) return _show('개인정보 수집·이용 동의가 필요합니다.');
    }
    final requestKey = _dailyRequestKey();
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: '단기직원 출퇴근 확인',
      barrierColor: const Color(0xA60F172A),
      pageBuilder: (dialogContext, _, __) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.fromLTRB(36, 34, 36, 28),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(30),
                boxShadow: const [
                  BoxShadow(
                      color: Color(0x3D0F172A),
                      blurRadius: 42,
                      offset: Offset(0, 18))
                ],
              ),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 68,
                  height: 68,
                  decoration: const BoxDecoration(
                      color: Color(0xffe8f2ff), shape: BoxShape.circle),
                  child: const Icon(Icons.verified_user_rounded,
                      color: Color(0xff3182f6), size: 36),
                ),
                const SizedBox(height: 20),
                Text(action == 'check_in' ? '$name님, 출근할까요?' : '입력한 번호로 퇴근할까요?',
                    style: const TextStyle(
                        fontSize: 25, fontWeight: FontWeight.w800),
                    textAlign: TextAlign.center),
                const SizedBox(height: 18),
                if (action == 'check_in')
                  _confirmationRow('주민번호', _maskedDailyResident(resident)),
                if (action == 'check_in') _confirmationRow('이름', name),
                _confirmationRow('전화번호', _maskedDailyPhone(phone)),
                const SizedBox(height: 12),
                const Text('확정 후에는 관리자에게 수정을 요청해야 합니다.',
                    style: TextStyle(color: Color(0xff8b95a1), fontSize: 13)),
                const SizedBox(height: 26),
                Row(children: [
                  Expanded(
                      child: OutlinedButton(
                          onPressed: () => Navigator.pop(dialogContext),
                          style: OutlinedButton.styleFrom(
                              minimumSize: const Size(0, 58)),
                          child: const Text('수정'))),
                  const SizedBox(width: 12),
                  Expanded(
                      child: FilledButton(
                          onPressed: () {
                            Navigator.pop(dialogContext);
                            _saveDailyWorker(
                                action: action,
                                requestKey: requestKey,
                                name: name,
                                resident: resident,
                                phone: phone);
                          },
                          child:
                              Text(action == 'check_in' ? '출근 등록' : '퇴근 등록'))),
                ])
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _confirmationRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child:
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(label, style: const TextStyle(color: Color(0xff8b95a1))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ]),
      );

  Widget _dailyWorkerPanel() {
    final checkIn = dailyAction == 'check_in';
    final inputDecoration = (String label, String hint) => InputDecoration(
        labelText: label, hintText: hint, border: const OutlineInputBorder());
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('단기직원 출퇴근',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
      const SizedBox(height: 6),
      const Text('이 태블릿에 연결된 사업장으로 근무 기록이 저장됩니다.',
          style: TextStyle(color: Color(0xff6b7684), fontSize: 14)),
      const SizedBox(height: 20),
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(
              value: 'check_in',
              label: Text('출근 등록'),
              icon: Icon(Icons.login_rounded)),
          ButtonSegment(
              value: 'check_out',
              label: Text('퇴근 등록'),
              icon: Icon(Icons.logout_rounded)),
        ],
        selected: {dailyAction},
        onSelectionChanged:
            busy ? null : (value) => _resetDailyWorkerForm(action: value.first),
        showSelectedIcon: false,
      ),
      const SizedBox(height: 20),
      if (checkIn) ...[
        TextField(
          controller: dailyName,
          textInputAction: TextInputAction.next,
          maxLength: 30,
          decoration: inputDecoration('이름', '신분증에 표시된 이름'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: dailyResident,
          keyboardType: TextInputType.number,
          obscureText: true,
          enableSuggestions: false,
          autocorrect: false,
          maxLength: 13,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: inputDecoration('주민등록번호', '숫자 13자리'),
        ),
        const SizedBox(height: 12),
      ],
      TextField(
        controller: dailyPhone,
        keyboardType: TextInputType.phone,
        maxLength: 11,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: inputDecoration('휴대전화 번호', '01012345678'),
      ),
      if (checkIn) ...[
        const SizedBox(height: 4),
        CheckboxListTile(
          value: dailyPrivacyConsent,
          onChanged: busy
              ? null
              : (value) {
                  setState(() => dailyPrivacyConsent = value == true);
                  _scheduleDailyPrivacyReset();
                },
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          title: const Text('개인정보 수집·이용에 동의합니다.',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          subtitle: const Text('출퇴근 식별과 근로 기록 관리를 위해 이름, 주민등록번호, 전화번호를 수집합니다.',
              style: TextStyle(fontSize: 12, height: 1.45)),
        ),
      ],
      const SizedBox(height: 16),
      Align(
        alignment: Alignment.center,
        child: SizedBox(
            width: 440,
            child: FilledButton(
                onPressed: busy ? null : _confirmDailyWorker,
                child: Text(busy
                    ? '처리 중…'
                    : checkIn
                        ? '출근 정보 확인'
                        : '퇴근 정보 확인'))),
      ),
      const SizedBox(height: 12),
      const Text('입력 정보는 2분 동안 조작이 없으면 자동으로 초기화됩니다.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Color(0xff8b95a1), fontSize: 11)),
    ]);
  }

  Future<void> _openKeypad(TextEditingController target, int maxLength) async {
    final selectedValue = await showGeneralDialog<String>(
        context: context,
        barrierDismissible: true,
        barrierLabel: '번호 입력',
        barrierColor: const Color(0x990F172A),
        transitionDuration: const Duration(milliseconds: 220),
        pageBuilder: (dialogContext, _, __) {
          String value = target.text;
          return StatefulBuilder(builder: (context, setDialog) {
            void update(String next) => setDialog(() => value = next);
            final keys = <Widget>[
              ...List.generate(
                  9, (index) => _key('${index + 1}', value, maxLength, update)),
              _key('0', value, maxLength, update),
              _key('⌫', value, maxLength, update, backspace: true)
            ];
            return SafeArea(
                child: Center(
                    child: ConstrainedBox(
                        constraints: BoxConstraints(
                            maxWidth: 640,
                            maxHeight: MediaQuery.sizeOf(context).height - 32),
                        child: SingleChildScrollView(
                            child: Material(
                                color: Colors.transparent,
                                child: Container(
                                  padding:
                                      const EdgeInsets.fromLTRB(28, 22, 28, 20),
                                  decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(28),
                                      boxShadow: const [
                                        BoxShadow(
                                            color: Color(0x3D0F172A),
                                            blurRadius: 42,
                                            offset: Offset(0, 18))
                                      ]),
                                  child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                            mode == 'attendance'
                                                ? '전화번호 뒷 4자리'
                                                : '전화번호 뒷 8자리',
                                            style: const TextStyle(
                                                fontSize: 20,
                                                color: Color(0xff191f28),
                                                fontWeight: FontWeight.w800)),
                                        const SizedBox(height: 12),
                                        AnimatedSwitcher(
                                            duration: const Duration(
                                                milliseconds: 120),
                                            child: Container(
                                                key: ValueKey(value),
                                                width: double.infinity,
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                        horizontal: 18,
                                                        vertical: 14),
                                                decoration: BoxDecoration(
                                                    color:
                                                        const Color(0xfff2f7ff),
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            16)),
                                                child: Text(
                                                    value.isEmpty
                                                        ? '번호를 입력해 주세요'
                                                        : value,
                                                    textAlign: TextAlign.center,
                                                    style: const TextStyle(
                                                        fontSize: 22,
                                                        letterSpacing: 3,
                                                        color:
                                                            Color(0xff2877dc),
                                                        fontWeight:
                                                            FontWeight.w800)))),
                                        const SizedBox(height: 14),
                                        GridView.count(
                                            shrinkWrap: true,
                                            physics:
                                                const NeverScrollableScrollPhysics(),
                                            crossAxisCount: 3,
                                            mainAxisSpacing: 10,
                                            crossAxisSpacing: 10,
                                            childAspectRatio: 2.1,
                                            children: keys),
                                        const SizedBox(height: 16),
                                        Row(children: [
                                          Expanded(
                                              child: TextButton(
                                                  onPressed: () =>
                                                      Navigator.pop(
                                                          dialogContext),
                                                  child: const Text('취소'))),
                                          const SizedBox(width: 12),
                                          Expanded(
                                              flex: 2,
                                              child: FilledButton(
                                                  onPressed: () =>
                                                      Navigator.pop(
                                                          dialogContext, value),
                                                  child: const Text('입력 완료')))
                                        ]),
                                      ]),
                                ))))));
          });
        },
        transitionBuilder: (_, animation, __, child) => FadeTransition(
            opacity: animation,
            child: ScaleTransition(
                scale: Tween<double>(begin: .94, end: 1).animate(
                    CurvedAnimation(
                        parent: animation, curve: Curves.easeOutCubic)),
                child: child)));
    if (selectedValue != null && mounted) {
      setState(() => target.text = selectedValue);
    }
  }

  Widget _key(String label, String value, int maxLength,
          void Function(String) update, {bool backspace = false}) =>
      Material(
          color: const Color(0xfff8fafc),
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
              borderRadius: BorderRadius.circular(18),
              splashColor: const Color(0x263182f6),
              highlightColor: const Color(0x143182f6),
              onTapDown: (_) {
                HapticFeedback.selectionClick();
                if (backspace) {
                  if (value.isNotEmpty)
                    update(value.substring(0, value.length - 1));
                } else if (value.length < maxLength) update('$value$label');
              },
              child: Center(
                  child: Text(label,
                      style: TextStyle(
                          fontSize: backspace ? 26 : 24,
                          color: const Color(0xff191f28),
                          fontWeight: FontWeight.w700)))));
  Future<void> _show(String text) async {
    setState(() => notice = text);
  }

  Widget _noticeOverlay() {
    final text = notice!;
    final isError = text.contains('실패') ||
        text.contains('오류') ||
        text.contains('확인해 주세요') ||
        text.contains('못했');
    final color = isError ? const Color(0xfff04452) : const Color(0xff3182f6);
    final icon = isError ? Icons.info_rounded : Icons.check_rounded;
    return Positioned.fill(
      child: Material(
        color: const Color(0x990F172A),
        child: Center(
          child: TweenAnimationBuilder<double>(
            key: ValueKey(text),
            tween: Tween(begin: .92, end: 1),
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOutBack,
            builder: (_, scale, child) =>
                Transform.scale(scale: scale, child: child),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Container(
                padding: const EdgeInsets.fromLTRB(36, 34, 36, 28),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(30),
                    boxShadow: const [
                      BoxShadow(
                          color: Color(0x3D0F172A),
                          blurRadius: 42,
                          offset: Offset(0, 18))
                    ]),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                      width: 66,
                      height: 66,
                      decoration: BoxDecoration(
                          color: color.withValues(alpha: .12),
                          shape: BoxShape.circle),
                      child: Icon(icon, color: color, size: 38)),
                  const SizedBox(height: 20),
                  Text(isError ? '다시 확인해 주세요' : '처리가 완료됐어요',
                      style: const TextStyle(
                          fontSize: 22,
                          color: Color(0xff191f28),
                          fontWeight: FontWeight.w800)),
                  const SizedBox(height: 12),
                  Text(text,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 16, color: Color(0xff6b7684), height: 1.5)),
                  const SizedBox(height: 28),
                  SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                          onPressed: () => setState(() => notice = null),
                          style: FilledButton.styleFrom(backgroundColor: color),
                          child: const Text('확인'))),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loadingDeviceSession) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (!deviceSessionReady) return _setup();
    return _terminal();
  }

  Widget _setup() {
    final form = Card(
        margin: const EdgeInsets.all(32),
        child: Padding(
            padding: const EdgeInsets.all(36),
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('TimeFit 태블릿 연결',
                      style:
                          TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 24),
                  TextField(
                      controller: email,
                      focusNode: emailFocus,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      onSubmitted: (_) => passwordFocus.requestFocus(),
                      decoration: const InputDecoration(labelText: '관리자 이메일')),
                  TextField(
                      controller: password,
                      focusNode: passwordFocus,
                      obscureText: true,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _activate(),
                      decoration: const InputDecoration(labelText: '비밀번호')),
                  const SizedBox(height: 24),
                  FilledButton(
                      onPressed: busy ? null : _activate,
                      child: Text(busy ? '연결 중…' : '사업장 태블릿으로 연결'))
                ])));
    final identity = Container(
        width: 360,
        padding: const EdgeInsets.all(44),
        color: const Color(0xff3182f6),
        child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('✓  timefit',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.bold)),
              Spacer(),
              Text('매장 운영 태블릿',
                  style: TextStyle(
                      color: Colors.white70, fontWeight: FontWeight.bold)),
              SizedBox(height: 12),
              Text('사업장에\n태블릿 연결',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 38,
                      height: 1.2,
                      fontWeight: FontWeight.bold)),
              SizedBox(height: 18),
              Text('관리자가 로그인해 이 기기를 사업장 전용 출퇴근 기기로 활성화합니다.',
                  style: TextStyle(color: Colors.white70, height: 1.6)),
              Spacer()
            ]));
    return Scaffold(
        resizeToAvoidBottomInset: true,
        body: Stack(children: [
          SafeArea(
              child: Center(
                  child: ConstrainedBox(
                      constraints:
                          const BoxConstraints(maxWidth: 1180, maxHeight: 760),
                      child: Card(
                          clipBehavior: Clip.antiAlias,
                          child: Row(children: [
                            identity,
                            Expanded(
                                child: SingleChildScrollView(
                                    child: Padding(
                                        padding: const EdgeInsets.all(48),
                                        child: form)))
                          ]))))),
          if (notice != null) _noticeOverlay()
        ]));
  }

  Widget _terminal() {
    final activePhone = mode == 'attendance' ? attendancePhone : leavePhone;
    final children = mode == 'daily'
        ? <Widget>[_dailyWorkerPanel()]
        : <Widget>[
            Text(
                mode == 'attendance'
                    ? '전화번호 뒷 4자리로 확인하세요'
                    : '전화번호와 날짜를 입력해 주세요.',
                style:
                    const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text(
                mode == 'attendance'
                    ? '확인 후 출근 또는 퇴근 버튼이 표시됩니다.'
                    : '오늘 이후 날짜에 대해 휴가를 신청할 수 있어요.',
                style: const TextStyle(color: Color(0xff6b7684), fontSize: 14)),
            const SizedBox(height: 24),
            InkWell(
                borderRadius: BorderRadius.circular(16),
                splashColor: const Color(0x1A3182f6),
                highlightColor: const Color(0x143182f6),
                onTapDown: (_) {
                  HapticFeedback.lightImpact();
                  _openKeypad(activePhone, mode == 'attendance' ? 4 : 8);
                },
                child: Container(
                    height: 76,
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    decoration: BoxDecoration(
                        color: const Color(0xfffbfcfe),
                        border: Border.all(
                            color: activePhone.text.isEmpty
                                ? const Color(0xffdfe5ec)
                                : const Color(0xff3182f6),
                            width: activePhone.text.isEmpty ? 1 : 2),
                        borderRadius: BorderRadius.circular(16)),
                    child: Row(children: [
                      Expanded(
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                            Text(
                                mode == 'attendance'
                                    ? '전화번호 뒷 4자리'
                                    : '전화번호 뒷 8자리',
                                style: const TextStyle(
                                    color: Color(0xff6b7684),
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold)),
                            const SizedBox(height: 4),
                            Text(
                                activePhone.text.isEmpty
                                    ? '숫자를 입력해 주세요'
                                    : activePhone.text,
                                style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.bold,
                                    color: activePhone.text.isEmpty
                                        ? const Color(0xff8b95a1)
                                        : const Color(0xff191f28)))
                          ])),
                      const Icon(Icons.dialpad_rounded,
                          color: Color(0xff3182f6))
                    ]))),
            if (mode == 'leave') ...[
              const SizedBox(height: 20),
              InkWell(
                  borderRadius: BorderRadius.circular(16),
                  splashColor: const Color(0x1A3182f6),
                  highlightColor: const Color(0x143182f6),
                  onTapDown: (_) async {
                    HapticFeedback.lightImpact();
                    final picked = await showDatePicker(
                        context: context,
                        firstDate: DateTime.now(),
                        lastDate: DateTime.now().add(const Duration(days: 365)),
                        initialDate:
                            DateTime.now().add(const Duration(days: 1)));
                    if (picked != null)
                      setState(() => date.text =
                          picked.toIso8601String().substring(0, 10));
                  },
                  child: Container(
                      height: 70,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      decoration: BoxDecoration(
                          color: const Color(0xfffbfcfe),
                          border: Border.all(color: const Color(0xffdfe5ec)),
                          borderRadius: BorderRadius.circular(16)),
                      child: Row(children: [
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                              const Text('휴가 날짜',
                                  style: TextStyle(
                                      color: Color(0xff6b7684),
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold)),
                              Text(
                                  date.text.isEmpty ? '날짜를 선택해 주세요' : date.text,
                                  style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold))
                            ])),
                        const Icon(Icons.calendar_month_rounded)
                      ]))),
              const SizedBox(height: 20),
              const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('휴가 종류',
                      style: TextStyle(fontWeight: FontWeight.bold))),
              Row(
                  children: ['연차', '오전 반차', '오후 반차'].map<Widget>((type) {
                final selected = leaveType == type;
                final amount = type == '연차' ? '1일' : '0.5일';
                return Expanded(
                    child: Padding(
                        padding: const EdgeInsets.only(right: 10),
                        child: SizedBox(
                            height: 82,
                            child: FilledButton(
                                onPressed: () =>
                                    setState(() => leaveType = type),
                                style: FilledButton.styleFrom(
                                    elevation: selected ? 5 : 0,
                                    backgroundColor: selected
                                        ? const Color(0xffeaf3ff)
                                        : Colors.white,
                                    foregroundColor: selected
                                        ? const Color(0xff2877dc)
                                        : const Color(0xff6b7684),
                                    shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(16),
                                        side: BorderSide(
                                            color: selected
                                                ? const Color(0xff3182f6)
                                                : const Color(0xffdfe5ec),
                                            width: selected ? 2 : 1))),
                                child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(amount,
                                          style: const TextStyle(
                                              fontSize: 20,
                                              fontWeight: FontWeight.bold)),
                                      Text(type,
                                          style: const TextStyle(fontSize: 13))
                                    ])))));
              }).toList()),
            ],
            const SizedBox(height: 24),
            Align(
                alignment: Alignment.center,
                child: SizedBox(
                    width: 440,
                    child: FilledButton(
                        onPressed: busy
                            ? null
                            : (mode == 'attendance' ? _lookup : _lookupLeave),
                        child: Text(busy
                            ? '확인 중…'
                            : (mode == 'attendance' ? '직원 확인' : '직원 확인'))))),
          ];
    final identity = Container(
        width: 360,
        padding: const EdgeInsets.all(44),
        color: const Color(0xff3182f6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('✓  timefit',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.bold)),
          const Spacer(),
          const Text('레오핏테크 · 버터블라 태블릿',
              style: TextStyle(
                  color: Colors.white70, fontWeight: FontWeight.bold)),
          const SizedBox(height: 14),
          Text(
              mode == 'attendance'
                  ? '빠르고 정확한\n직원 출퇴근'
                  : mode == 'leave'
                      ? '간편한\n휴가 신청'
                      : mode == 'daily'
                          ? '간편하고 안전한\n단기직원 출퇴근'
                          : '휴대폰으로\nQR 출퇴근',
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 38,
                  height: 1.2,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 18),
          const Text('관리자 연결이 완료된 사업장 전용 태블릿입니다.',
              style: TextStyle(color: Colors.white70, height: 1.6)),
          const Spacer()
        ]));
    return Scaffold(
      body: Stack(children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180, maxHeight: 760),
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: Row(children: [
                identity,
                Expanded(
                    child: SingleChildScrollView(
                        child: Padding(
                  padding: const EdgeInsets.all(48),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              TextButton.icon(
                                  onPressed: busy ? null : _disconnectTablet,
                                  icon: const Icon(Icons.logout_rounded,
                                      size: 18),
                                  label: const Text('관리자 로그아웃')),
                              Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 9),
                                  decoration: BoxDecoration(
                                      color: const Color(0xffe8f8f0),
                                      borderRadius: BorderRadius.circular(30)),
                                  child: const Text('● 연결됨',
                                      style: TextStyle(
                                          color: Color(0xff15915c),
                                          fontWeight: FontWeight.bold))),
                            ]),
                        const SizedBox(height: 24),
                        Container(
                            padding: const EdgeInsets.all(6),
                            decoration: BoxDecoration(
                                color: const Color(0xfff2f4f6),
                                borderRadius: BorderRadius.circular(16)),
                            child: Row(children: [
                              Expanded(
                                  child: FilledButton(
                                      onPressed: () =>
                                          _selectMode('attendance'),
                                      style: FilledButton.styleFrom(
                                          elevation: 0,
                                          backgroundColor: mode == 'attendance'
                                              ? Colors.white
                                              : Colors.transparent,
                                          foregroundColor: mode == 'attendance'
                                              ? const Color(0xff3182f6)
                                              : const Color(0xff6b7684),
                                          minimumSize: const Size(0, 60)),
                                      child: const FittedBox(
                                          fit: BoxFit.scaleDown,
                                          child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.schedule_rounded,
                                                    size: 20),
                                                SizedBox(width: 7),
                                                Text('출퇴근')
                                              ])))),
                              const SizedBox(width: 6),
                              Expanded(
                                  child: FilledButton(
                                      onPressed: () => _selectMode('leave'),
                                      style: FilledButton.styleFrom(
                                          elevation: 0,
                                          backgroundColor: mode == 'leave'
                                              ? Colors.white
                                              : Colors.transparent,
                                          foregroundColor: mode == 'leave'
                                              ? const Color(0xff3182f6)
                                              : const Color(0xff6b7684),
                                          minimumSize: const Size(0, 60)),
                                      child: const FittedBox(
                                          fit: BoxFit.scaleDown,
                                          child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.event_note_rounded,
                                                    size: 20),
                                                SizedBox(width: 7),
                                                Text('휴가 신청')
                                              ])))),
                              const SizedBox(width: 6),
                              Expanded(
                                  child: FilledButton(
                                      onPressed: () => _selectMode('daily'),
                                      style: FilledButton.styleFrom(
                                          elevation: 0,
                                          backgroundColor: mode == 'daily'
                                              ? Colors.white
                                              : Colors.transparent,
                                          foregroundColor: mode == 'daily'
                                              ? const Color(0xff3182f6)
                                              : const Color(0xff6b7684),
                                          minimumSize: const Size(0, 60)),
                                      child: const FittedBox(
                                          fit: BoxFit.scaleDown,
                                          child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.badge_outlined,
                                                    size: 20),
                                                SizedBox(width: 7),
                                                Text('단기직원')
                                              ])))),
                              const SizedBox(width: 6),
                              Expanded(
                                  child: FilledButton(
                                      onPressed: () => _selectMode('qr'),
                                      style: FilledButton.styleFrom(
                                          elevation: 0,
                                          backgroundColor: mode == 'qr'
                                              ? Colors.white
                                              : Colors.transparent,
                                          foregroundColor: mode == 'qr'
                                              ? const Color(0xff3182f6)
                                              : const Color(0xff6b7684),
                                          minimumSize: const Size(0, 60)),
                                      child: const FittedBox(
                                          fit: BoxFit.scaleDown,
                                          child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.qr_code_2_rounded,
                                                    size: 20),
                                                SizedBox(width: 7),
                                                Text('출퇴근 QR')
                                              ]))))
                            ])),
                        const SizedBox(height: 38),
                        Container(
                            padding: const EdgeInsets.all(32),
                            decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(24),
                                border:
                                    Border.all(color: const Color(0xffe8eef6)),
                                boxShadow: const [
                                  BoxShadow(
                                      color: Color(0x12255e99),
                                      blurRadius: 26,
                                      offset: Offset(0, 12))
                                ]),
                            child: mode == 'qr'
                                ? _attendanceQrPanel()
                                : Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: children)),
                      ]),
                )))
              ]),
            ),
          ),
        ),
        if (notice != null) _noticeOverlay(),
      ]),
    );
  }

  Widget _attendanceQrPanel() {
    if (qrLoading && qrToken == null) {
      return const SizedBox(
        height: 420,
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(),
            SizedBox(height: 18),
            Text('업장 고정 QR을 불러오고 있어요',
                style: TextStyle(
                    color: Color(0xff6b7684), fontWeight: FontWeight.w700)),
          ]),
        ),
      );
    }
    if (qrError != null && qrToken == null) {
      return SizedBox(
        height: 420,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.qr_code_2_rounded,
                  size: 72, color: Color(0xff8b95a1)),
              const SizedBox(height: 18),
              Text(qrError!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      color: Color(0xff6b7684), fontSize: 16, height: 1.5)),
              const SizedBox(height: 22),
              FilledButton.icon(
                onPressed: qrLoading ? null : _loadAttendanceQr,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('다시 불러오기'),
              ),
            ]),
          ),
        ),
      );
    }
    if (qrToken == null) return const SizedBox(height: 420);
    Widget qrCard(double size) => Semantics(
          label: '${qrOrganizationName ?? '현재 업장'} 출퇴근 QR 코드',
          image: true,
          child: Container(
            width: size,
            height: size,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xffdfe5ec)),
            ),
            child: QrImageView(
              data: mobileAttendanceQrUrl(qrToken!),
              version: QrVersions.auto,
              errorCorrectionLevel: QrErrorCorrectLevel.H,
              backgroundColor: Colors.white,
            ),
          ),
        );
    final copy = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('고정 업장 QR',
            style: TextStyle(
                color: Color(0xff3182f6), fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text('${qrOrganizationName ?? '현재 업장'} 출퇴근',
            style: const TextStyle(
                color: Color(0xff191f28),
                fontSize: 27,
                fontWeight: FontWeight.w800)),
        const SizedBox(height: 14),
        const Text(
          '직원 휴대폰에서 TimeFit 앱의 QR 출퇴근을 열고 이 코드를 스캔해 주세요.',
          style:
              TextStyle(color: Color(0xff4e5968), fontSize: 16, height: 1.55),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xffe8f8f0),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.lock_rounded, size: 18, color: Color(0xff15915c)),
            SizedBox(width: 8),
            Flexible(
              child: Text('한 번 발급된 QR은 자동으로 바뀌지 않아요',
                  style: TextStyle(
                      color: Color(0xff15915c), fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
        const SizedBox(height: 18),
        TextButton.icon(
          onPressed: qrLoading ? null : _loadAttendanceQr,
          icon: qrLoading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.refresh_rounded),
          label: const Text('같은 QR 다시 불러오기'),
        ),
      ],
    );
    return LayoutBuilder(builder: (context, constraints) {
      final compact = constraints.maxWidth < 640;
      if (compact) {
        final qrSize = constraints.maxWidth.clamp(220.0, 300.0);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(child: qrCard(qrSize)),
            const SizedBox(height: 28),
            copy,
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          qrCard(330),
          const SizedBox(width: 32),
          Expanded(child: copy),
        ],
      );
    });
  }
}
