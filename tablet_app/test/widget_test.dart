import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timefit_tablet/main.dart';

void main() {
  test('ships with the production RPC connection by default', () {
    expect(supabaseUrl, 'https://xzcvgxnhospcedeebnsf.supabase.co');
    expect(supabasePublishableKey, startsWith('sb_publishable_'));
    expect(supabasePublishableKey, isNotEmpty);
  });

  testWidgets('renders native tablet setup', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const TimeFitTabletApp());
    await tester.pumpAndSettle();
    expect(find.text('TimeFit 태블릿 연결'), findsOneWidget);
  });

  testWidgets('restores a persisted tablet device session', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1280, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    SharedPreferences.setMockInitialValues({
      'device_token': 'persisted-device-token',
    });

    await tester.pumpWidget(const TimeFitTabletApp());
    await tester.pumpAndSettle();

    expect(find.text('● 연결됨'), findsOneWidget);
    expect(find.text('출퇴근'), findsOneWidget);
    expect(find.text('휴가 신청'), findsOneWidget);
    expect(find.text('단기직원'), findsOneWidget);
    expect(find.text('출퇴근 QR'), findsOneWidget);
    expect(find.text('TimeFit 태블릿 연결'), findsNothing);

    await tester.tap(find.text('단기직원'));
    await tester.pumpAndSettle();
    expect(find.text('단기직원 출퇴근'), findsOneWidget);
    expect(find.text('출근 등록'), findsOneWidget);
    expect(find.text('퇴근 등록'), findsOneWidget);
    expect(find.text('개인정보 수집·이용에 동의합니다.'), findsOneWidget);
  });

  test(
    'builds the mobile attendance deep link without changing the QR token',
    () {
      expect(
        mobileAttendanceQrUrl('fixed-token'),
        'https://timefit-mobile.vercel.app/?qr=fixed-token#attendance',
      );
    },
  );
}
