-- Nivaran · Supabase setup. Safe to run more than once.
-- Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Generated from data/sops.json by: npm run supabase:sql

-- 1. SOP knowledge base (the RAG source) -------------------------------------
create table if not exists public.sop_sections (
  id           text primary key,
  scheme       text not null,
  scheme_label text not null,
  section      text not null,
  title        text not null,
  text         text not null,
  keywords     text[] not null default '{}',
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now()
);

-- 2. Log of every live AI request: numbers only, no citizen text --------------
create table if not exists public.ai_runs (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  feature        text not null check (feature in ('judge', 'copilot')),
  model          text,
  ai_calls       int,
  tokens_in      int,
  tokens_out     int,
  cost_inr       numeric(10,4),
  score          int,
  verdict        text,
  scheme         text,
  failure_modes  text[],
  revised        boolean,
  reply_type     text,
  language       text,
  latency_ms     int,
  kb_source      text,
  prompt_version text
);
create index if not exists ai_runs_created_at_idx on public.ai_runs (created_at desc);

-- 3. Security: Row Level Security on, no public policies.
--    Only the server (service key, kept in Vercel env vars) can read or write. The browser never talks to Supabase.
alter table public.sop_sections enable row level security;
alter table public.ai_runs enable row level security;

-- 4. Usage summary read by the How it works page ------------------------------
create or replace view public.ai_run_stats with (security_invoker = true) as
select
  feature,
  count(*)::int                                                as runs,
  round(avg(cost_inr), 4)                                      as avg_cost_inr,
  round(avg(tokens_in))::int                                   as avg_tokens_in,
  round(avg(tokens_out))::int                                  as avg_tokens_out,
  round(avg(ai_calls), 2)                                      as avg_ai_calls,
  round(avg(latency_ms))::int                                  as avg_latency_ms,
  round(avg(score))::int                                       as avg_score,
  round(100.0 * avg((verdict = 'hollow')::int), 1)             as pct_hollow,
  round(100.0 * avg((verdict = 'resolved')::int), 1)           as pct_resolved,
  round(100.0 * avg(coalesce(revised, false)::int), 1)         as pct_revised,
  round(sum(cost_inr), 2)                                      as total_cost_inr,
  min(created_at)                                              as first_run,
  max(created_at)                                              as last_run
from public.ai_runs
group by feature;

-- 5. Load the 22 SOP sections ------------------------------------------------
insert into public.sop_sections (id, scheme, scheme_label, section, title, text, keywords, sort_order) values
  ('GEN-1', 'GENERAL', 'General grievance handling', '1', 'Action Taken Report: minimum contents', 'An Action Taken Report (ATR) that closes a grievance must state: (a) what was found on examining the citizen''s record; (b) the specific action taken or ordered, and the officer role responsible for it; (c) the date by which the citizen will see the outcome; (d) what happens next if the outcome does not happen by that date; and (e) the appeal route. A reply that only acknowledges receipt, restates the portal status, or forwards the case does not count as disposal.', ARRAY['atr', 'action taken report', 'disposal', 'closure', 'reply', 'contents']::text[], 1),
  ('GEN-2', 'GENERAL', 'General grievance handling', '2', 'Transfers between offices', 'A grievance may be transferred only when the receiving office has jurisdiction over the issue. The transferring officer must record the reason, name the receiving office, and tell the citizen the timeline within which the receiving office will act. A transfer is not a disposal: the grievance stays open until the receiving office files an ATR.', ARRAY['transfer', 'forwarded', 'concerned department', 'jurisdiction', 'other office']::text[], 2),
  ('GEN-3', 'GENERAL', 'General grievance handling', '3', 'Appeals and repeat grievances', 'A citizen dissatisfied with a closure may file an appeal within 30 days of closure; the appellate authority must decide the appeal within 30 days. A repeat grievance from the same citizen on the same issue within 90 days of closure triggers a review of the original closure by the supervising officer.', ARRAY['appeal', 'repeat', 'reopen', 'dissatisfied', 'review']::text[], 3),
  ('GEN-4', 'GENERAL', 'General grievance handling', '4', 'Verifying disputed records', 'When a complaint disputes a record held by the party complained against (for example a delivery, payment or inspection record), the officer must verify the facts independently, using the citizen''s statement and a third-party record such as a bank statement, OTP log or signed acknowledgement. The complained-against party''s own record is not sufficient grounds to close the grievance.', ARRAY['disputed', 'record', 'evidence', 'verify', 'delivered', 'distributor', 'agency']::text[], 4),
  ('PMK-3.1', 'PM-KISAN', 'PM-KISAN', '3.1', 'Eligibility and installment schedule', 'Eligible farmer families receive Rs 6,000 a year in three installments of Rs 2,000 each, credited by Direct Benefit Transfer to the Aadhaar-seeded bank account. If an installment shows ''under process'' for more than 30 days, the State Nodal Officer must investigate and give the beneficiary a written status update within 7 working days.', ARRAY['installment', 'instalment', 'under process', '6000', '2000', 'dbt', 'farmer', 'kisan']::text[], 5),
  ('PMK-4.2', 'PM-KISAN', 'PM-KISAN', '4.2', 'NPCI verification failure handling', 'If an installment fails NPCI verification (rejection codes R01 to R09, for example R03 account name mismatch), the District Agriculture Officer must notify the beneficiary within 3 working days with the exact rejection code and the correction needed. Once the beneficiary corrects the bank or Aadhaar details, the re-verification request is processed in the next weekly NPCI batch and the held installment is re-sent.', ARRAY['npci', 'rejection', 'r03', 'bank', 'aadhaar', 'mismatch', 'failed', 'payment failed']::text[], 6),
  ('PMK-5.1', 'PM-KISAN', 'PM-KISAN', '5.1', 'eKYC, land records and delayed installments', 'Installments are held while eKYC is incomplete or land records are unverified. The beneficiary must be told which of the two is pending and where to complete it (OTP eKYC on the portal, biometric eKYC at a Common Service Centre, or land verification at the tehsil). Held installments are released in the next batch after completion. Scheme guidelines provide no compensation or interest for delayed installments.', ARRAY['ekyc', 'kyc', 'land record', 'held', 'compensation', 'interest', 'delay', 'csc']::text[], 7),
  ('NSAP-3.1', 'NSAP', 'NSAP pensions', '3.1', 'Pension disbursement delays', 'Old-age, widow and disability pensions must be credited on or before the 7th of each month. If a pension is delayed by more than 45 days, the case is escalated to the State Nodal Officer with bank statement verification and Aadhaar re-authentication. The District Social Welfare Officer must give the beneficiary a written explanation within 15 days and initiate re-disbursement.', ARRAY['pension', 'widow', 'old age', 'not credited', 'delay', 'passbook', 'dswo']::text[], 8),
  ('NSAP-4.1', 'NSAP', 'NSAP pensions', '4.1', 'Arrears after a missed pension', 'Once the cause of a missed pension is fixed, all pending months are paid as arrears in a single credit with the next monthly disbursement. The beneficiary must be told the arrear amount and the credit date in writing.', ARRAY['arrears', 'pending months', 'missed', 'back payment']::text[], 9),
  ('NSAP-5.2', 'NSAP', 'NSAP pensions', '5.2', 'Escalation to the State Level Monitoring Committee', 'NSAP grievances unresolved for more than 60 days at district level must be escalated to the State Level Monitoring Committee, which acknowledges within 5 working days and gives a resolution timeline. A repeat grievance from the same beneficiary within 90 days triggers an automatic review.', ARRAY['escalation', 'state level', 'monitoring committee', '60 days', 'repeat']::text[], 10),
  ('EPF-6.1', 'EPFO', 'EPFO', '6.1', 'PF transfer claims', 'If the previous employer does not approve a transfer claim on the UAN portal within 15 days, the member may have it attested by the present employer, or the field office processes it after verifying service details. Transfer claims must be settled within 20 days of a complete claim. A rejection must give specific reasons with document references, and the member must be told by email and SMS within 3 working days of the rejection.', ARRAY['transfer', 'pf', 'uan', 'employer', 'approve', 'attest', 'claim']::text[], 11),
  ('EPF-7.2', 'EPFO', 'EPFO', '7.2', 'EPS widow and family pension', 'A widow or family pension claim under EPS must be settled within 20 days of complete documents (death certificate, Form 10D, bank details). If documents are incomplete, the office must send one consolidated deficiency letter within 10 days listing every missing item; repeated piecemeal requests are not allowed. Pension is payable from the day after the member''s death, with arrears.', ARRAY['eps', 'widow', 'family pension', 'death', 'form 10d', 'husband', 'under process']::text[], 12),
  ('EPF-8.1', 'EPFO', 'EPFO', '8.1', 'Grievance handling and office visits', 'EPFiGMS grievances must be disposed of within 15 days. A member must not be asked to visit the office unless an original document has to be verified, and the reply must name that document. Replies must state the claim status, the reason for any delay and the settlement date.', ARRAY['epfigms', 'visit', 'office', 'grievance', 'status', 'settlement']::text[], 13),
  ('PSP-4.1', 'PASSPORT', 'Passport', '4.1', 'Application processing timeline', 'Normal passport applications must be processed within 30 days of submission. If police verification is pending beyond 21 days, the Regional Passport Officer (RPO) must escalate to the SSP/SP of the district. Applicants must not be asked to visit the RPO in person unless biometric re-capture is technically required.', ARRAY['passport', 'pending', 'police verification', 'rpo', 'processing', 'application']::text[], 14),
  ('PSP-4.3', 'PASSPORT', 'Passport', '4.3', 'Printing, dispatch and tracking', 'Printed passports are dispatched by Speed Post within 3 working days of printing and the tracking number is sent by SMS. If the passport is not delivered within 10 days of dispatch, the RPO raises a postal enquiry and informs the applicant of the outcome within 7 working days.', ARRAY['dispatch', 'printed', 'speed post', 'tracking', 'delivery', 'not received']::text[], 15),
  ('PSP-6.1', 'PASSPORT', 'Passport', '6.1', 'Urgent cases', 'An applicant with documented urgency (a job offer, admission or medical emergency with a deadline) may request expedited processing. The RPO must decide on the request within 3 working days of receiving the proof and tell the applicant the expected issue date.', ARRAY['urgent', 'job offer', 'deadline', 'expedite', 'medical', 'abroad']::text[], 16),
  ('NSP-3.2', 'NSP', 'National Scholarship', '3.2', 'Application verification levels', 'Scholarship applications are verified first by the institute nodal officer and then by the district or state nodal officer. If an application is pending at institute level for more than 15 days, the district nodal officer must send a reminder and, after 7 more days, verify the application directly.', ARRAY['scholarship', 'verification', 'institute', 'nodal officer', 'pending', 'application']::text[], 17),
  ('NSP-5.1', 'NSP', 'National Scholarship', '5.1', 'Disbursement failures', 'If a scholarship payment fails because the bank account is inactive or not Aadhaar-seeded, the student must be informed within 7 days with the reason. After the student corrects the account, payment is retried in the next payment cycle, and the student is told the retry date.', ARRAY['scholarship', 'payment failed', 'not received', 'bank', 'aadhaar seeded', 'disbursement']::text[], 18),
  ('LPG-2.4', 'LPG', 'LPG / PMUY', '2.4', 'Disputed cylinder deliveries', 'When a consumer disputes a refill delivery recorded by the distributor, the oil company''s sales officer must verify independently within 7 days, using the delivery authentication code (DAC/OTP) log, the consumer''s statement and the delivery person''s record. The distributor''s record alone is not proof of delivery. If delivery is not proven, a replacement refill is delivered within 48 hours at no extra cost.', ARRAY['lpg', 'cylinder', 'delivered', 'distributor', 'refill', 'otp', 'dac', 'gas']::text[], 19),
  ('LPG-3.1', 'LPG', 'LPG / PMUY', '3.1', 'Refill booking delays', 'Refill bookings must be delivered within 3 working days. A delay beyond that is escalated to the oil company''s territory office, which must contact the consumer within 2 working days with a delivery date.', ARRAY['booking', 'refill', 'delay', 'lpg', 'ujjwala', 'pmuy']::text[], 20),
  ('PDS-2.1', 'PDS', 'PDS ration card', '2.1', 'Cancellation of ration cards', 'A ration card cannot be cancelled without written notice and an opportunity to be heard. If a card was cancelled without notice, the District Supply Officer must verify the household and restore the card within 15 days; the household can draw its entitlement for the current month as soon as the card is restored.', ARRAY['ration card', 'cancelled', 'cancellation', 'notice', 'pds', 'restore']::text[], 21),
  ('PDS-3.3', 'PDS', 'PDS ration card', '3.3', 'Denial of entitlement at a fair price shop', 'If a fair price shop denies a household its entitlement, the area food inspector must inquire within 7 days and record statements from the household and the shop. If the denial is confirmed, the shop must supply the entitlement within 3 days and action is initiated against the dealer.', ARRAY['fair price shop', 'fps', 'rice', 'wheat', 'denied', 'refuses', 'ration']::text[], 22)
on conflict (id) do update set
  scheme = excluded.scheme, scheme_label = excluded.scheme_label, section = excluded.section,
  title = excluded.title, text = excluded.text, keywords = excluded.keywords,
  sort_order = excluded.sort_order, updated_at = now();

-- Check: should return 22
select count(*) as sop_sections_loaded from public.sop_sections;
