export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { complaintText, officerResponse, scheme } = req.body;

    // --- Validation ---
    if (!complaintText || !complaintText.trim()) {
      return res.status(400).json({ error: "Complaint text is required." });
    }
    if (!officerResponse || !officerResponse.trim()) {
      return res.status(400).json({ error: "Officer response is required." });
    }
    if (complaintText.trim().length < 10) {
      return res.status(400).json({ error: "Complaint text is too short. Please provide a real complaint." });
    }
    if (officerResponse.trim().length < 10) {
      return res.status(400).json({ error: "Officer response is too short. Please provide a real response." });
    }
    if (complaintText.length > 5000 || officerResponse.length > 5000) {
      return res.status(400).json({ error: "Input too long. Please keep each field under 5000 characters." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!supabaseUrl || !supabaseKey || !geminiKey) {
      return res.status(500).json({ error: "Server configuration error. Environment variables missing." });
    }

    // --- Retrieve SOPs ---
    let sops = [];
    if (scheme && scheme !== "Other") {
      try {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=4`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        if (r.ok) sops = await r.json();
      } catch (e) {
        // Supabase fetch failed, continue without SOPs
      }
    }

    const sopCtx = sops.length > 0
      ? sops.map(s => `${s.scheme} - ${s.section}:\n${s.body}`).join("\n\n---\n\n")
      : "NO SOP DOCUMENTS WERE RETRIEVED FOR THIS SCHEME. Evaluate based on general quality criteria only. Note in your explanation that no scheme-specific SOP was available for comparison.";

    // --- Build evaluation prompt ---
    const prompt = `You are the Nivaran Resolution Judge. You evaluate whether a government officer's response to a citizen complaint genuinely resolves the issue or is a hollow closure.

EVALUATION CRITERIA (score each 0 to 100):

1. ADDRESSES_COMPLAINT (0-100): Does the response directly address the specific issue raised?
   - 0-20: Completely ignores the complaint or answers a different question
   - 21-50: Partially acknowledges but misses key issues
   - 51-75: Addresses the main issue but misses secondary points
   - 76-100: Fully addresses every point raised in the complaint

2. SPECIFIC_ACTION (0-100): Does the response provide concrete, actionable steps?
   - 0-20: No actions at all, just acknowledgment
   - 21-50: Vague actions like "will be looked into"
   - 51-75: Some specific actions but missing details (who, when, how)
   - 76-100: Clear, specific actions with responsible parties and timelines

3. POLICY_GROUNDED (0-100): Is the response grounded in actual policy or SOP?
   - 0-20: No policy reference whatsoever
   - 21-50: Generic policy mention without specifics
   - 51-75: References a policy but without exact section or detail
   - 76-100: Cites specific SOP sections, circular numbers, or rule references

4. AVOIDS_BOILERPLATE (0-100): Is the response unique to this case or generic?
   - 0-20: Pure boilerplate ("advised suitably", "forwarded to concerned dept")
   - 21-50: Mostly generic with minor case-specific details
   - 51-75: Mix of specific and generic language
   - 76-100: Entirely case-specific, clearly written for this complaint

5. CITIZEN_NEXT_STEPS (0-100): Does the citizen know what to do next?
   - 0-20: No guidance at all
   - 21-50: Told to "wait" or "contact helpline"
   - 51-75: Some guidance but vague on timeline or process
   - 76-100: Clear steps with timelines, documents needed, and escalation path

FIVE FAILURE MODES TO CHECK (from DARPG ATR analysis):
- STATUS_RESTATEMENT: Officer repeats what the system record shows without investigating the gap
- BOILERPLATE: Generic "advised suitably" or "forwarded to concerned department" language
- DEFLECTION: Case closed by forwarding to another office without resolution
- INSTITUTIONAL_BIAS: The party being complained about supplies the evidence used to close the complaint
- BURDEN_TRANSFER: Citizen told to visit in person or call a helpline without the file being advanced

REFERENCE SOPs (if available):
${sopCtx}

CITIZEN COMPLAINT:
"${complaintText.replace(/"/g, '\\"')}"

OFFICER RESPONSE:
"${officerResponse.replace(/"/g, '\\"')}"

INSTRUCTIONS:
- Score each criterion as an INTEGER from 0 to 100 using the rubric above.
- For failureModes, list ONLY the modes you actually detected. Use an empty array [] if none.
- Write a 2-3 sentence explanation covering what the response does well and what it fails on.
- If no SOPs were available, note that in your explanation.

Return ONLY this JSON structure, no other text:
{"criteria":[{"name":"Addresses Complaint","score":INTEGER_0_TO_100},{"name":"Specific Action Provided","score":INTEGER_0_TO_100},{"name":"Policy Grounded","score":INTEGER_0_TO_100},{"name":"Avoids Boilerplate","score":INTEGER_0_TO_100},{"name":"Citizen Next Steps","score":INTEGER_0_TO_100}],"failureModes":["LIST_DETECTED_MODES_OR_EMPTY"],"explanation":"YOUR_2_3_SENTENCE_EXPLANATION"}`;

    // --- Call Gemini with retry ---
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
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();

        const parsed = JSON.parse(raw);

        // --- Validate the parsed response ---
        if (!parsed.criteria || !Array.isArray(parsed.criteria) || parsed.criteria.length !== 5) {
          lastError = "Invalid criteria array from model";
          continue;
        }

        let valid = true;
        for (const c of parsed.criteria) {
          if (typeof c.score !== "number" || c.score < 0 || c.score > 100) {
            valid = false;
            break;
          }
          // Catch the 0/1 bug: if all scores are 0 or 1, model misunderstood the scale
          c.score = Math.round(c.score);
        }

        // If all scores are <= 1, the model used boolean scale. Reject and retry.
        const allTiny = parsed.criteria.every(c => c.score <= 1);
        if (allTiny) {
          lastError = "Model returned boolean scores instead of 0-100 scale";
          continue;
        }

        if (!valid) {
          lastError = "Scores out of range";
          continue;
        }

        evaluation = parsed;
        break;

      } catch (e) {
        lastError = e.message;
        continue;
      }
    }

    if (!evaluation) {
      return res.status(500).json({
        error: "Evaluation failed after retries. " + (lastError || "Unknown error."),
        retryable: true,
      });
    }

    // --- Calculate overall score and verdict in code, not from the model ---
    const scores = evaluation.criteria.map(c => c.score);
    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    // Determine ok flag for each criterion
    evaluation.criteria = evaluation.criteria.map(c => ({
      ...c,
      ok: c.score >= 50,
    }));

    // Determine verdict using fixed thresholds
    let decision;
    if (overallScore >= 70) decision = "Resolved";
    else if (overallScore >= 40) decision = "Likely Hollow";
    else decision = "Definitely Hollow";

    // Clean failure modes: only allow known values
    const knownModes = ["STATUS_RESTATEMENT", "BOILERPLATE", "DEFLECTION", "INSTITUTIONAL_BIAS", "BURDEN_TRANSFER"];
    const cleanedModes = (evaluation.failureModes || [])
      .filter(fm => typeof fm === "string" && fm.length > 0)
      .map(fm => {
        // Try to match to known modes
        const upper = fm.toUpperCase().replace(/[^A-Z_]/g, "_");
        const match = knownModes.find(k => upper.includes(k.replace("_", "")) || upper.includes(k));
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
      model: "gemini-2.0-flash-lite",
      sopCount: sops.length,
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message, retryable: true });
  }
}
