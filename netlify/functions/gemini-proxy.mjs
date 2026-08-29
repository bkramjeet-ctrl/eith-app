// Server-side proxy for the Gemini API.
//
// Keeps the site owner's Gemini API key out of the browser entirely — it
// lives only in this function's environment (set in the Netlify dashboard
// under Site settings → Environment variables → GEMINI_API_KEY), never in
// any file that ships to visitors. app.js calls this endpoint instead of
// calling generativelanguage.googleapis.com directly.
//
// This does NOT solve shared free-tier rate limits — every visitor who
// doesn't supply their own key draws from the same quota as everyone else,
// including the owner. It only prevents the raw key from being extracted.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: { message: "Server is missing GEMINI_API_KEY — the site owner needs to set it in Netlify's environment variables." },
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON body" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { model, ...body } = payload;
  if (!model || typeof model !== "string") {
    return new Response(JSON.stringify({ error: { message: "Missing \"model\" field" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    }
  );

  // Pass Gemini's response straight through — success or error — so the
  // client's existing error handling (which reads body.error.message) keeps working.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  path: "/api/gemini",
};
