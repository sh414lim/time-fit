import '../domain/models/tablet_models.dart';
import '../infrastructure/tablet_repository.dart';

class TabletController {
  TabletController(this.repository);
  final TabletRepository repository;
  bool busy = false;
  TabletDevice? device;
  EmployeeLookup? employee;
  Future<void> connect(String email, String password, String deviceName) async { busy = true; try { device = await repository.activate(email: email, password: password, deviceName: deviceName); } finally { busy = false; } }
  Future<void> lookup(String phoneLast4) async { busy = true; try { employee = await repository.lookupAttendance(device!.token, phoneLast4); } finally { busy = false; } }
  Future<String> saveAttendance(String phoneLast4) => repository.saveAttendance(device!.token, phoneLast4, employee!.nextAction);
  Future<String> submitLeave(LeaveDraft draft) => repository.submitLeave(device!.token, draft);
}
