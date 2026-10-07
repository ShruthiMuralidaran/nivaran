// Blind-labeling kit. Creates eval/blind_labeling_sheet.csv WITHOUT the team's labels, in shuffled order.
// Give it to someone who did not build Nivaran. They fill the "your_label" column with resolved / review / hollow
// and save the file as eval/blind_labels.csv. `npm run eval` then scores the Judge against THEIR labels.
//   Run: npm run label-kit
const fs = require('fs');
const path = require('path');
const cases = require('../data/cases');
const { EXTRA } = require('./eval-cases');

const all = [...cases, ...EXTRA];
// Deterministic shuffle so re-running gives the same sheet.
let seed = 42;
const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const shuffled = all.map((c) => ({ c, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.c);

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const lines = [['case_id', 'scheme', 'complaint', 'officer_reply', 'your_label'].join(',')];
shuffled.forEach((c) => lines.push([c.id, c.scheme, c.complaint, c.atr, ''].map(q).join(',')));
const out = path.join(__dirname, '..', 'eval', 'blind_labeling_sheet.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
console.log(`Wrote ${all.length} cases to ${out}

Instructions for the labeler (someone who did NOT build Nivaran):
  For each row, read the complaint and the officer's reply and write ONE word in "your_label":
    resolved  - the reply actually deals with the problem: specific action, owner, date or proof
    review    - partly there: specific but missing a timeline, owner or outcome
    hollow    - template, forwarding, status repeat, "visit the office", or answers something else
  Save the file as eval/blind_labels.csv, then run: npm run eval`);
