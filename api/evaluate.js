export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { complaintText, officerResponse, scheme } = req.body;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    let sops = [];
    if (scheme && scheme !== "Other") {
      const r = await fetch(`${supabaseUrl}/rest/v1/sop_documents?scheme=ilike.*${encodeURIComponent(scheme)}*&select=scheme,section,body&limit=4`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
      sops = await r.json();
    }
    const sopCtx = sops.length > 0 ? sops.map(s => `${s.scheme} - ${s.section}: ${s.body}`).join("\n\n") : "No specific SOP documents available.";

    const prompt = `You are the Nivaran Resolution Judge. Evaluate whether a government officer's response to a citizen complaint genuinely resolves the issue or is a hollow closure.

Evaluate against these five failure modes from DARPG's ATR analysis:
1. STATUS RESTATEMENT: Officer repeats system record without investigating.
2. "ADVISED SUITABLY" BOILERPLATE: Generic response not addressing the specific complaint.
3. DEFLECTION: Case closed by forwarding without resolution.
4. INSTITUTIONAL BIAS: Complained-about party supplies the closing evidence.
5. BURDEN TRANSFER: Citizen redirected to visit/helpline without advancing file.

REFERENCE SOPs:
${sopCtx}

CITIZEN COMPLAINT:
"${complaintText}"

OFFICER RESPONSE:
"${officerResponse}"

RESPOND IN THIS EXACT JSON FORMAT ONLY. No markdown, no backticks, no extra text before or after the JSON:
{"overallScore":0,"decision":"Resolved","confidence":0,"criteria":[{"name":"Addresses Complaint","score":0,"ok":false},{"name":"Specific Action Provided","score":0,"ok":false},{"name":"Policy Grounded","score":0,"ok":false},{"name":"Avoids Boilerplate","score":0,"ok":false},{"name":"Citizen Next Steps","score":0,"ok":false}],"failureModes":[],"explanation":""}

Fill in the actual scores and evaluation. Return ONLY the JSON object.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
        }),
      }
    );
    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) return res.status(500).json({ error: "Gemini error", details: geminiData });

    const raw = geminiData.candidates[0].content.parts[0].text.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
    const usage = geminiData.usageMetadata || {};

    let ev;
    try { ev = JSON.parse(raw); }
    catch { ev = { overallScore:50, decision:"Parse Error", confidence:0, criteria:[{name:"Addresses Complaint",score:50,ok:false},{name:"Specific Action Provided",score:50,ok:false},{name:"Policy Grounded",score:50,ok:false},{name:"Avoids Boilerplate",score:50,ok:false},{name:"Citizen Next Steps",score:50,ok:false}], failureModes:[], explanation:"Parse failed. Try again." }; }

    return res.status(200).json({
      ...ev,
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}
