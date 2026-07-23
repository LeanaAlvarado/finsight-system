import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, otp, name } = await req.json();

    if (!email || !otp) {
      return new Response(JSON.stringify({ error: "Email and OTP are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const googleScriptUrl = Deno.env.get("GOOGLE_SCRIPT_URL");
    const googleScriptSecret = Deno.env.get("GOOGLE_SCRIPT_SECRET") || "";

    if (!googleScriptUrl) {
      return new Response(JSON.stringify({ error: "GOOGLE_SCRIPT_URL is not configured in Supabase Secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const googleResponse = await fetch(googleScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        otp,
        name,
        secret: googleScriptSecret
      })
    });

    const googleResult = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok || googleResult.ok === false) {
      return new Response(JSON.stringify({
        error: googleResult.error || "Unable to send OTP email through Google.",
        details: googleResult
      }), {
        status: googleResponse.status || 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Unexpected OTP email error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
