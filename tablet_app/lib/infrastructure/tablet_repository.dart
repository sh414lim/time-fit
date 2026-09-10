import 'package:supabase_flutter/supabase_flutter.dart';
import '../domain/models/tablet_models.dart';

class TabletRepository {
  TabletRepository(this.client);
  final SupabaseClient client;
  Future<TabletDevice> activate({required String email, required String password, required String deviceName}) async {
    await client.auth.signInWithPassword(email: email, password: password);
    final org = await client.rpc('timefit_user_get_manager_tablet_organization');
    final result = await client.rpc('timefit_user_activate_tablet_device', params: {'p_organization_id': org['organizationId'], 'p_display_name': deviceName, 'p_metadata': {'native': true}});
    await client.auth.signOut();
    return TabletDevice(token: result['deviceToken'] as String, organizationName: org['organizationName'] as String? ?? '사업장', deviceName: deviceName);
  }
  Future<EmployeeLookup> lookupAttendance(String token, String phoneLast4) async {
    final result = await client.rpc('timefit_user_tablet_attendance_v2', params: {'p_device_token': token, 'p_phone_last4': phoneLast4, 'p_action': 'lookup'});
    return EmployeeLookup(name: result['employeeName'] as String, nextAction: result['nextAction'] as String);
  }
  Future<String> saveAttendance(String token, String phoneLast4, String action) async {
    final result = await client.rpc('timefit_user_tablet_attendance_v2', params: {'p_device_token': token, 'p_phone_last4': phoneLast4, 'p_action': action});
    return result['employeeName'] as String;
  }
  Future<String> submitLeave(String token, LeaveDraft draft) async {
    final result = await client.rpc('timefit_user_tablet_leave_request_v2', params: {'p_device_token': token, 'p_phone_last8': draft.phoneLast8, 'p_starts_on': draft.date.toIso8601String().substring(0, 10), 'p_ends_on': draft.date.toIso8601String().substring(0, 10), 'p_leave_type': draft.type});
    return result['employeeName'] as String;
  }
}
