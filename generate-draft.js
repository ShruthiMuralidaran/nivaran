export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { complaintId, citizenName, scheme, department, complaintText } = req.body;

    // --- 1. Retrieve relevant SOPs from Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    // Search by scheme match
    const sopResponse = await fetch(
      `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=5`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    const sops = await sopResponse.json();

    const sopContext =
      sops.length > 0
        ? sops
            .map((s, i) => `[Source ${i + 1}] ${s.scheme} - ${s.section}\n${s.body}`)
            .join("\n\n")
        : "No specific SOP documents found. Use general government communication guidelines.";

    // --- 2. Build prompt and call OpenAI ---
    const systemPrompt = `You are Nivaran Copilot, an AI assistant that helps government Grievance Redressal Officers (GROs) draft responses to citizen complaints.

CRITICAL RULES:
- ONLY use facts from the RETRIEVED DOCUMENTS below. Never invent policies, dates, amounts, or procedures.
- Every claim must be traceable to a specific SOP section. Cite sections inline like (per SOP Section X.Y).
- Provide SPECIFIC next steps the citizen can take, with timelines where available.
- Address the citizen by name. Reference their specific complaint details.
- Never use boilerplate phrases like "forwarded to concerned department" or "advised suitably".
- Be empathetic but precise. Use formal but clear language.

RETRIEVED DOCUMENTS:
${sopContext}`;

    const userPrompt = `Draft a response for this citizen complaint:

Complaint ID: ${complaintId}
Citizen: ${citizenName}
Scheme: ${scheme}
Department: ${department}
Complaint: "${complaintText}"

Start with "Dear Mr./Ms. ${citizenName}," and end with "Regards, Grievance Cell, Department of ${department}".`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    const openaiData = await openaiRes.json();

    if (!openaiRes.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: openaiData });
    }

    // --- 3. Return draft + citations + usage ---
    const citations = sops.map((s) => ({
      source: s.scheme,
      section: s.section,
    }));

    return res.status(200).json({
      draft: openaiData.choices[0].message.content,
      citations,
      usage: openaiData.usage,
      sopCount: sops.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
