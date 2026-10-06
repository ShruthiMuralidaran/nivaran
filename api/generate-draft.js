export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { complaintId, citizenName, scheme, department, complaintText } = req.body;

    // --- Validation ---
    if (!complaintText || !complaintText.trim()) {
      return res.status(400).json({ error: "Complaint text is required." });
    }
    if (!citizenName || !citizenName.trim()) {
      return res.status(400).json({ error: "Citizen name is required." });
    }
    if (complaintText.trim().length < 10) {
      return res.status(400).json({ error: "Complaint text is too short." });
    }
    if (complaintText.length > 5000) {
      return res.status(400).json({ error: "Complaint text too long. Max 5000 characters." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!supabaseUrl || !supabaseKey || !geminiKey) {
      return res.status(500).json({ error: "Server configuration error. Environment variables missing." });
    }

    // --- Retrieve SOPs from Supabase ---
    let sops = [];
    try {
      const sopRes = await fetch(
        `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=5`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (sopRes.ok) sops = await sopRes.json();
    } catch (e) {
      // Supabase failed, continue but flag it
    }

    // --- If no SOPs found, return human review message ---
    if (sops.length === 0) {
      return res.status(200).json({
        draft: null,
        noSopFound: true,
        message: `No applicable SOP found for scheme "${scheme}". Human review required. Do not generate a response without verified policy documents.`,
        citations: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        sopCount: 0,
        model: "gemini-2.0-flash-lite",
      });
    }

    // --- Build RAG prompt ---
    const sopContext = sops.map((s, i) =>
      `[SOURCE ${i + 1}] ${s.scheme} - ${s.section}\n${s.body}`
    ).join("\n\n---\n\n");

    const prompt = `You are Nivaran Copilot, an AI assistant that helps government Grievance Redressal Officers draft responses to citizen complaints.

ABSOLUTE RULES - VIOLATION OF ANY RULE MAKES THE DRAFT UNSAFE:

1. ONLY state facts that appear in the RETRIEVED DOCUMENTS below. If a fact is not in the documents, do NOT include it.
2. Every deadline, amount, entitlement, process, or escalation path you mention MUST come from a specific source below. Cite it inline as (per [SOURCE X] Section Y.Z).
3. NEVER invent or assume:
   - Deadlines that are not in the documents
   - Compensation amounts that are not in the documents
   - Escalation promises that are not in the documents
   - Government actions that are not in the documents
4. If the documents do not contain enough information to fully address the complaint, say: "For aspects of your complaint not covered by the available policy documents, we are routing your case to a senior officer for manual review."
5. Do NOT use these phrases: "forwarded to concerned department", "advised suitably", "you are requested to wait", "for further queries contact helpline".
6. Address the citizen by name.
7. Provide specific next steps ONLY if they come from the documents.

RETRIEVED DOCUMENTS:
${sopContext}

COMPLAINT:
Complaint ID: ${complaintId || "N/A"}
Citizen: ${citizenName}
Scheme: ${scheme}
Department: ${department}
Complaint: "${complaintText.replace(/"/g, '\\"')}"

Draft a response now. Start with "Dear Mr./Ms. ${citizenName}," and end with "Regards, Grievance Cell, Department of ${department}".
Every factual claim must cite its source document.`;

    // --- Call Gemini ---
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1500 }
        }),
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      const errMsg = errData.error?.message || "Gemini API error";
      // If model unavailable, suggest retry
      if (errData.error?.code === 503) {
        return res.status(503).json({ error: "AI model temporarily busy. Please try again in a few seconds.", retryable: true });
      }
      return res.status(500).json({ error: errMsg });
    }

    const geminiData = await geminiRes.json();
    const draft = geminiData.candidates[0].content.parts[0].text;
    const usage = geminiData.usageMetadata || {};

    // --- Build citations from retrieved SOPs ---
    const citations = sops.map(s => ({
      source: s.scheme,
      section: s.section,
    }));

    return res.status(200).json({
      draft,
      noSopFound: false,
      citations,
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
      sopCount: sops.length,
      model: "gemini-3.5-flash-lite",
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message, retryable: true });
  }
}
