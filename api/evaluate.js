export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { complaintText, officerResponse, scheme } = req.body;

    // --- 1. Retrieve relevant SOPs from Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    let sops = [];
    if (scheme) {
      const sopRes = await fetch(
        `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=4`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );
      sops = await sopRes.json();
    }

    const sopContext =
      sops.length > 0
        ? sops.map((s) => `${s.scheme} - ${s.section}: ${s.body}`).join("\n\n")
        : "No specific SOP documents available for comparison.";

    // --- 2. Build evaluation prompt ---
    const systemPrompt = `You are the Nivaran Resolution Judge, an AI system that evaluates whether a government officer's response to a citizen complaint genuinely resolves the issue or is a hollow closure.

You evaluate against five failure modes documented by DARPG:
1. STATUS RESTATEMENT: Officer repeats what the system record shows without investigating.
2. "ADVISED SUITABLY" BOILERPLATE: Generic response that does not address the specific complaint.
3. DEFLECTION ("Forwarded to"): Case closed by transferring to another office without resolution.
4. INSTITUTIONAL BIAS: The party being complained about supplies the evidence used to close the complaint.
5. BURDEN TRANSFER: Citizen redirected to in-person visit or helpline without advancing the file.

RETRIEVED SOP DOCUMENTS:
${sopContext}

RESPOND IN THIS EXACT JSON FORMAT ONLY. No markdown, no backticks, no extra text:
{
  "overallScore": <number 0-100>,
  "decision": "<Resolved | Likely Hollow | Definitely Hollow>",
  "confidence": <number 0-100>,
  "criteria": [
    {"name": "Addresses Complaint", "score": <0-100>, "ok": <true/false>},
    {"name": "Specific Action Provided", "score": <0-100>, "ok": <true/false>},
    {"name": "Policy Grounded", "score": <0-100>, "ok": <true/false>},
    {"name": "Avoids Boilerplate", "score": <0-100>, "ok": <true/false>},
    {"name": "Citizen Next Steps", "score": <0-100>, "ok": <true/false>}
  ],
  "failureModes": ["<detected failure modes or empty array>"],
  "explanation": "<2-3 sentence explanation>"
}`;

    const userPrompt = `CITIZEN COMPLAINT:\n"${complaintText}"\n\nOFFICER RESPONSE:\n"${officerResponse}"\n\nEvaluate now.`;

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
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    const openaiData = await openaiRes.json();

    if (!openaiRes.ok) {
      return res.status(500).json({ error: "OpenAI API error", details: openaiData });
    }

    // --- 3. Parse JSON response ---
    let evaluation;
    try {
      const raw = openaiData.choices[0].message.content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      evaluation = JSON.parse(raw);
    } catch {
      evaluation = {
        overallScore: 50,
        decision: "Parse Error",
        confidence: 0,
        criteria: [
          { name: "Addresses Complaint", score: 50, ok: false },
          { name: "Specific Action Provided", score: 50, ok: false },
          { name: "Policy Grounded", score: 50, ok: false },
          { name: "Avoids Boilerplate", score: 50, ok: false },
          { name: "Citizen Next Steps", score: 50, ok: false },
        ],
        failureModes: [],
        explanation: "Could not parse evaluation. Please try again.",
      };
    }

    return res.status(200).json({
      ...evaluation,
      usage: openaiData.usage,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
