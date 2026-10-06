export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { complaintId, citizenName, scheme, department, complaintText } = req.body;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // 1. Retrieve SOPs from Supabase
    const sopRes = await fetch(
      `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=5`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const sops = await sopRes.json();
    const sopContext = sops.length > 0
      ? sops.map((s, i) => `[Source ${i+1}] ${s.scheme} - ${s.section}\n${s.body}`).join("\n\n")
      : "No specific SOP documents found. Use general government communication guidelines.";

    // 2. Call Gemini
    const prompt = `You are Nivaran Copilot, an AI assistant that helps government Grievance Redressal Officers draft responses to citizen complaints.

CRITICAL RULES:
- ONLY use facts from the RETRIEVED DOCUMENTS below. Never invent policies.
- Cite SOP sections inline like (per SOP Section X.Y).
- Provide SPECIFIC next steps with timelines.
- Address the citizen by name.
- Never use boilerplate like "forwarded to concerned department" or "advised suitably".

RETRIEVED DOCUMENTS:
${sopContext}

COMPLAINT:
Complaint ID: ${complaintId}
Citizen: ${citizenName}
Scheme: ${scheme}
Department: ${department}
Complaint: "${complaintText}"

Draft a response. Start with "Dear Mr./Ms. ${citizenName}," and end with "Regards, Grievance Cell, Department of ${department}".`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
        }),
      }
    );
    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) return res.status(500).json({ error: "Gemini error", details: geminiData });

    const draft = geminiData.candidates[0].content.parts[0].text;
    const usage = geminiData.usageMetadata || {};

    return res.status(200).json({
      draft,
      citations: sops.map(s => ({ source: s.scheme, section: s.section })),
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
      sopCount: sops.length,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}
