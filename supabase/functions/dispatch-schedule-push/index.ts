import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Outbox = { id: string; recipient_user_id: string; event_type: string; payload: Record<string, unknown>; attempt_count: number };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth_secret: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const dispatchSecret = Deno.env.get("SCHEDULE_PUSH_DISPATCH_SECRET");
  if (!dispatchSecret || request.headers.get("x-timefit-dispatch-secret") !== dispatchSecret) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("WEB_PUSH_PUBLIC_KEY");
  const privateKey = Deno.env.get("WEB_PUSH_PRIVATE_KEY");
  const subject = Deno.env.get("WEB_PUSH_SUBJECT") ?? "mailto:support@timefit.kr";
  if (!url || !serviceKey || !publicKey || !privateKey) return json({ error: "server_configuration_missing" }, 500);

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const { data: rows, error } = await client.from("timefit_user_schedule_notification_outbox").select("id,recipient_user_id,event_type,payload,attempt_count").eq("status", "pending").lte("available_at", new Date().toISOString()).order("created_at").limit(50);
  if (error) return json({ error: "outbox_read_failed" }, 500);
  const outbox = (rows ?? []) as Outbox[];
  const userIds = [...new Set(outbox.map((row) => row.recipient_user_id))];
  const { data: subscriptions } = userIds.length ? await client.from("timefit_user_mobile_push_subscriptions").select("id,user_id,endpoint,p256dh,auth_secret").in("user_id", userIds).is("revoked_at", null) : { data: [] };
  const byUser = new Map<string, Subscription[]>();
  for (const subscription of (subscriptions ?? []) as Subscription[]) byUser.set(subscription.user_id, [...(byUser.get(subscription.user_id) ?? []), subscription]);

  let sent = 0; let failed = 0;
  for (const row of outbox) {
    const targets = byUser.get(row.recipient_user_id) ?? [];
    if (!targets.length) continue;
    await client.from("timefit_user_schedule_notification_outbox").update({ status: "processing", attempt_count: row.attempt_count + 1 }).eq("id", row.id).eq("status", "pending");
    const workDate = String(row.payload?.workDate ?? "");
    const message = JSON.stringify({ title: row.event_type === "schedule_changed" ? "근무 일정이 변경됐어요" : "근무 일정이 확정됐어요", body: workDate ? `${workDate} 일정을 확인해 주세요.` : "내 스케줄을 확인해 주세요.", tag: `schedule-${String(row.payload?.scheduleId ?? row.id)}`, deeplink: `/#schedule` });
    let delivered = false; let lastError = "";
    for (const target of targets) {
      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth_secret } }, message, { TTL: 86400 });
        delivered = true; sent += 1;
      } catch (pushError) {
        const statusCode = Number((pushError as { statusCode?: number }).statusCode ?? 0);
        lastError = pushError instanceof Error ? pushError.message.slice(0, 500) : "push_delivery_failed";
        if (statusCode === 404 || statusCode === 410) await client.from("timefit_user_mobile_push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", target.id);
      }
    }
    if (delivered) await client.from("timefit_user_schedule_notification_outbox").update({ status: "sent", processed_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
    else { failed += 1; await client.from("timefit_user_schedule_notification_outbox").update({ status: "failed", processed_at: new Date().toISOString(), last_error: lastError || "no_active_delivery" }).eq("id", row.id); }
  }
  return json({ processed: outbox.length, sent, failed });
});
