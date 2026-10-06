-- Run this in Supabase SQL Editor (supabase.com > your project > SQL Editor)

CREATE TABLE IF NOT EXISTS sop_documents (
  id SERIAL PRIMARY KEY,
  scheme TEXT NOT NULL,
  section TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}'
);

ALTER TABLE sop_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON sop_documents FOR SELECT USING (true);

INSERT INTO sop_documents (scheme, section, keywords, body) VALUES

('PM-KISAN', 'Section 4.2 - NPCI Verification Failure Handling',
 ARRAY['npci', 'verification', 'payment', 'installment', 'bank', 'aadhaar', 'mismatch'],
 'If an installment fails due to NPCI rejection (codes R01 to R09), the district officer shall notify the beneficiary within 3 working days, providing the exact rejection reason and remediation steps. Re-verification requests are processed in the next weekly NPCI batch. Common rejection codes: R03 (Account Description Mismatch) requires the beneficiary to update bank account name to match Aadhaar. R04 (Invalid Account Number) requires re-linking via pmkisan.gov.in beneficiary status page.'),

('PM-KISAN', 'Section 3.1 - Eligibility and Installment Schedule',
 ARRAY['eligibility', 'installment', 'schedule', 'land', 'farmer', 'kisan'],
 'Under PM-KISAN, eligible farmer families receive Rs 6,000 per year in three installments of Rs 2,000 each. Installments are credited directly to the bank account linked via Aadhaar. If an installment is marked as under process for more than 30 days, the state nodal officer must investigate and provide a written status update to the beneficiary within 7 working days.'),

('NSAP', 'Section 3.1 - Pension Disbursement Delays',
 ARRAY['pension', 'widow', 'old age', 'delay', 'disbursement', 'nsap'],
 'Widow pension delays exceeding 45 days must be escalated to the state nodal officer with bank statement verification and Aadhaar re-authentication. The state must ensure pension is credited on or before the 7th of each month. If disbursement fails, the District Social Welfare Officer must issue a written explanation within 15 days and initiate re-disbursement.'),

('NSAP', 'Section 5.2 - Grievance Escalation Protocol',
 ARRAY['grievance', 'escalation', 'pension', 'complaint', 'nsap'],
 'Grievances related to NSAP pension non-payment that remain unresolved for more than 60 days at the district level must be escalated to the State Level Monitoring Committee. The committee must acknowledge receipt within 5 working days and provide a resolution timeline. Repeat grievances from the same beneficiary within 90 days trigger an automatic review.'),

('EPFO', 'Section 6.1 - PF Transfer and Settlement',
 ARRAY['pf', 'epfo', 'transfer', 'settlement', 'claim', 'provident fund'],
 'PF transfer claims must be settled within 20 days of submission if all documents are in order. If the claim is rejected, the APFC must provide specific rejection reasons with document references. Common rejection reasons include: employer not verified on UAN portal, KYC mismatch between member records, or incomplete Form 13. The member must be informed via registered email and SMS within 3 working days of rejection.'),

('EPFO', 'Section 7.3 - EPS Pension Claims for Dependents',
 ARRAY['eps', 'pension', 'widow', 'dependent', 'nominee', 'death'],
 'For EPS pension claims by widows or dependents of deceased members, the Regional Office must process the claim within 30 days of receipt. Required documents: death certificate, nominee declaration (Form 10D), bank account details of claimant, and Aadhaar of claimant. If the claim involves inter-office transfer, the receiving office must acknowledge within 7 days and the transferring office must dispatch records within 15 days.'),

('Passport', 'Section 4.1 - Application Processing Timeline',
 ARRAY['passport', 'application', 'delay', 'police', 'verification', 'mea'],
 'Normal passport applications must be processed within 30 days of submission. Tatkal applications must be processed within 7 working days. If police verification is pending beyond 21 days, the RPO must escalate to the SSP/SP of the concerned district. Applicants must not be asked to visit the RPO in person unless biometric re-capture is technically required. Helpline numbers must be functional during office hours (9:30 AM to 5:30 PM).'),

('National Scholarship', 'Section 6.4 - Post-Matric SC/ST Disbursement',
 ARRAY['scholarship', 'sc', 'st', 'post-matric', 'disbursement', 'nsp'],
 'Post-matric scholarship for SC/ST categories is disbursed in two tranches. The first tranche (50%) is released upon institutional verification via NSP portal. The second tranche is released after attendance verification at the end of the academic term. Institutional verification must be completed within 15 working days of student application. Delays beyond 30 days must be reported to the State Scholarship Division with reasons.');
