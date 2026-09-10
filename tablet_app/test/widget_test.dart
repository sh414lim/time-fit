import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timefit_tablet/main.dart';

void main() {
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
    expect(find.text('TimeFit 태블릿 연결'), findsNothing);
  });
}
