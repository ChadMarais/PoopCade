import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const PRODUCTION_ORIGIN = "https://poopcade.com";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serverCredential =
  Deno.env.get("SUPABASE_SECRET_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serverCredential) {
  throw new Error("Supabase server environment is not configured.");
}

const supabaseAdmin = createClient(supabaseUrl, serverCredential, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

function responseHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": PRODUCTION_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");

  // Browsers always send Origin for this cross-origin Edge Function request.
  // Non-browser clients may omit it, but still require a valid user JWT below.
  if (origin !== null && origin !== PRODUCTION_ORIGIN) {
    return jsonResponse({ error: "Origin not allowed." }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !user || user.is_anonymous === true || user.app_metadata?.provider === "anonymous") {
    return jsonResponse({ error: "A verified account session is required." }, 401);
  }

  // The deletion target comes only from the verified JWT. No request body or
  // client-provided user ID participates in choosing the account.
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id, false);
  if (deleteError) {
    return jsonResponse({ error: "Account deletion failed. Please try again." }, 500);
  }

  return jsonResponse({ deleted: true }, 200);
});
