export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { complaintText, officerResponse, scheme } = req.body;

    if (!complaintText || !complaintText.trim()) return res.status(400).json({ error: "Complaint text is required." });
    if (!officerResponse || !officerResponse.trim()) return res.status(400).json({ error: "Officer response is required." });
    if (complaintText.trim().length < 10) return res.status(400).json({ error: "Complaint text is too short." });
    if (officerResponse.trim().length < 10) return res.status(400).json({ error: "Officer response is too short." });
    if (complaintText.length > 5000 || officerResponse.length > 5000) return res.status(400).json({ error: "Input too long. Max 5000 characters each." });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!supabaseUrl || !supabaseKey || !geminiKey) return res.status(500).json({ error: "Server config error. Environment variables missing." });

    let sops = [];
    if (scheme && scheme !== "Other") {
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=4`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        if (r.ok) sops = await r.json();
      } catch (e) { /* continue without SOPs */ }
    }

    const sopCtx = sops.length > 0
      ? sops.map(s => `${s.scheme} - ${s.section}:\n${s.body}`).join("\n\n---\n\n")
      : "NO SOP DOCUMENTS WERE RETRIEVED. Evaluate based on general quality criteria only.";

    const prompt = `You are the Nivaran Resolution Judge. Evaluate whether a government officer's response to a citizen complaint genuinely resolves the issue or is a hollow closure.

EVALUATION CRITERIA (score each 0 to 100):

1. ADDRESSES_COMPLAINT (0-100): Does the response directly address the specific issue raised?
   0-20: Completely ignores the complaint. 21-50: Partially acknowledges. 51-75: Addresses main issue. 76-100: Fully addresses every point.

2. SPECIFIC_ACTION (0-100): Does the response provide concrete, actionable steps?
   0-20: No actions. 21-50: Vague like "will be looked into". 51-75: Some specific actions. 76-100: Clear actions with timelines.

3. POLICY_GROUNDED (0-100): Is the response grounded in actual policy?
   0-20: No policy reference. 21-50: Generic mention. 51-75: References policy without detail. 76-100: Cites specific SOP sections.

4. AVOIDS_BOILERPLATE (0-100): Is the response unique to this case?
   0-20: Pure boilerplate. 21-50: Mostly generic. 51-75: Mix of specific and generic. 76-100: Entirely case-specific.

5. CITIZEN_NEXT_STEPS (0-100): Does the citizen know what to do next?
   0-20: No guidance. 21-50: Told to wait or call helpline. 51-75: Some guidance. 76-100: Clear steps with timelines.

IMPORTANT: Each score MUST be an integer between 0 and 100. For example 85, 42, 15. NOT 0 or 1. NOT true or false.

FIVE FAILURE MODES TO CHECK:
- STATUS_RESTATEMENT: Officer repeats system record without investigating
- BOILERPLATE: Generic "advised suitably" or "forwarded to concerned department"
- DEFLECTION: Case closed by forwarding without resolution
- INSTITUTIONAL_BIAS: Complained-about party supplies closing evidence
- BURDEN_TRANSFER: Citizen told to visit in person without advancing file

REFERENCE SOPs:
${sopCtx}

CITIZEN COMPLAINT:
"${complaintText.replace(/"/g, '\\"')}"

OFFICER RESPONSE:
"${officerResponse.replace(/"/g, '\\"')}"

Return ONLY this JSON. No markdown, no backticks, no text before or after:
{"criteria":[{"name":"Addresses Complaint","score":85},{"name":"Specific Action Provided","score":72},{"name":"Policy Grounded","score":68},{"name":"Avoids Boilerplate","score":90},{"name":"Citizen Next Steps","score":77}],"failureModes":[],"explanation":"Two sentence explanation here."}

The example scores above are just examples. Replace them with YOUR evaluation. Every score must be 0-100.`;

    let evaluation = null;
    let usage = {};
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 600 }
            }),
          }
        );

        if (!geminiRes.ok) {
          const errData = await geminiRes.json();
          lastError = errData.error?.message || "Gemini API error";
          continue;
        }

        const geminiData = await geminiRes.json();
        usage = geminiData.usageMetadata || {};

        const raw = geminiData.candidates[0].content.parts[0].text
          .replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

        const parsed = JSON.parse(raw);

        if (!parsed.criteria || !Array.isArray(parsed.criteria) || parsed.criteria.length !== 5) {
          lastError = "Invalid criteria array";
          continue;
        }

        for (const c of parsed.criteria) {
          c.score = Math.round(c.score);
        }

        // If model returned boolean 0/1 instead of 0-100, flag it
        const allTiny = parsed.criteria.every(c => c.score <= 1);
        if (allTiny) {
          lastError = "MODEL_BOOLEAN";
          continue;
        }

        // Clamp any out-of-range scores
        for (const c of parsed.criteria) {
          if (c.score < 0) c.score = 0;
          if (c.score > 100) c.score = 100;
        }

        evaluation = parsed;
        break;

      } catch (e) {
        lastError = e.message;
        continue;
      }
    }

    if (!evaluation) {
      if (lastError === "MODEL_BOOLEAN") {
        return res.status(422).json({
          error: "The AI model could not score this response on a 0-100 scale. This can happen with very short or ambiguous officer responses. Please try with a longer, more detailed officer response.",
          retryable: true,
          hint: "Use the 'Good response' or 'Boilerplate response' buttons to test with a sample first."
        });
      }
      return res.status(500).json({
        error: "Evaluation failed. " + (lastError || "Please try again."),
        retryable: true,
      });
    }

    // Compute overall score in code
    const scores = evaluation.criteria.map(c => c.score);
    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    evaluation.criteria = evaluation.criteria.map(c => ({
      ...c,
      ok: c.score >= 50,
    }));

    let decision;
    if (overallScore >= 70) decision = "Resolved";
    else if (overallScore >= 40) decision = "Likely Hollow";
    else decision = "Definitely Hollow";

    const knownModes = ["STATUS_RESTATEMENT", "BOILERPLATE", "DEFLECTION", "INSTITUTIONAL_BIAS", "BURDEN_TRANSFER"];
    const cleanedModes = (evaluation.failureModes || [])
      .filter(fm => typeof fm === "string" && fm.length > 0)
      .map(fm => {
        const upper = fm.toUpperCase().replace(/[^A-Z_]/g, "_");
        const match = knownModes.find(k => upper.includes(k.replace("_", "")));
        return match || fm;
      });

    return res.status(200).json({
      overallScore,
      decision,
      criteria: evaluation.criteria,
      failureModes: cleanedModes,
      explanation: evaluation.explanation || "No explanation provided.",
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
      model: "gemini-3.5-flash-lite",
      sopCount: sops.length,
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message, retryable: true });
  }
}
