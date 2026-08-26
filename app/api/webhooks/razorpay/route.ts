import { fail, json, workspaceView } from "@/lib/api";
import { mutateWorkspace } from "@/lib/db/store";
import type { RazorpayPayment } from "@/lib/razorpay/client";
import { razorpayStatus, verifyWebhookSignature } from "@/lib/razorpay/client";
import { applyRazorpayWebhook } from "@/lib/razorpay/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Payload = {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    payment_link?: {
      entity?: {
        id?: string;
        short_url?: string;
        notes?: Record<string, string> | string[];
      };
    };
  };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const status = razorpayStatus();
  if (status.webhookConfigured && !verifyWebhookSignature(raw, signature)) {
    return fail("Invalid Razorpay signature", 401);
  }
  if (!status.webhookConfigured) {
    return fail("RAZORPAY_WEBHOOK_SECRET is not set", 401);
  }

  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return fail("Invalid JSON");
  }

  const event = body.event ?? "";
  const payment = body.payload?.payment?.entity;
  const link = body.payload?.payment_link?.entity;

  try {
    const ws = await mutateWorkspace((current) =>
      applyRazorpayWebhook(current, { event, payment, link }),
    );
    return json({ ok: true, event, ...workspaceView(ws) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Webhook failed", 500);
  }
}
