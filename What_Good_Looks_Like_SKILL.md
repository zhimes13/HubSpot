---
name: arcis-membership-audit
description: Audit an Arcis Golf HubSpot membership deal against the "What A Good Compensable Membership Sale Looks Like" checklist before it is approved as Closed Won and paid out as incentive. Use this skill any time the user asks to review, audit, verify, QA, or validate a membership sale, a Closed Won deal, or a commission/incentive payout — or uses phrases like "is this deal ready to close", "can I pay this incentive", "review this sale", "check this membership", "is this compensable", or references a deal by name/ID in the context of month-end close. Also trigger when the user uploads or pastes a HubSpot deal record, a membership application, or an incentive report and asks whether it qualifies. Do NOT use for new-prospect pipeline review, tournament deals, private event deals, or non-membership pipelines.
---

# Arcis Golf — Compensable Membership Sale Audit

This skill audits a single HubSpot membership deal against Arcis Golf's standard for a **compensable** sale. A sale is only eligible for incentive payout when every item below passes.

## Scope

- **Applies to:** deals in the **Membership** pipeline (`pipeline = 29312913`) and the **Upgrades** pipeline (`pipeline = 113039508`).
- **Does not apply to:** Private Event, Tournament, Subscriptions, Card, or Actualized Events pipelines.

## How to run an audit

1. Identify the deal. Accept a deal name, HubSpot deal ID, or URL. If only a member name is given, search `deals` by `dealname` first.
2. Pull the deal record with every property listed in the **Properties to fetch** section below, plus associated contacts, associated line items, and attached files/notes.
3. Walk the **14-point checklist** top-to-bottom. For each item, mark `PASS`, `FAIL`, or `NEEDS HUMAN REVIEW` (when the answer can't be determined from HubSpot alone).
4. Produce the **Audit Report** in the format at the bottom of this file.
5. Never mark a deal compensable if any item is `FAIL`. One `NEEDS HUMAN REVIEW` is acceptable but must be flagged explicitly to the GM, Accountant, and RVP.

## Properties to fetch

On the deal itself:

- `dealname`, `dealstage`, `dealtype`, `pipeline`
- `hs_is_closed_won`, `closedate`, `createdate`
- `amount`, `if_amount`, `member_offer`
- `hubspot_owner_id`
- `hs_num_of_associated_line_items`, `num_associated_contacts`
- `num_notes`, `num_contacted_notes`, `notes_last_contacted`
- `description`

Associations to pull:

- Associated contact(s) — need `email`, `hubspot_owner_id`, lifecyclestage, and any property that indicates they were a Qualified Lead.
- Associated line items — need product name, quantity, price. Expect at minimum an IF line and a Dues line.
- Attached files — need the signed application, countersigned application, installment agreement (if applicable), and signed exception (if applicable).
- Engagement activity — meetings, tours, calls, notes logged against the deal or contact.

## The 14-point checklist

Work through these in order. Cite the HubSpot property or association you used to make each determination.

### 1. Closed Won before month end
- `hs_is_closed_won = "true"` AND `dealstage` resolves to a "Closed Won" stage for the deal's pipeline.
- For the Membership pipeline, Closed Won is `dealstage = 66876087`.
- For the Upgrades pipeline, confirm the Closed Won stage ID from the pipeline's stage list before asserting.
- The `closedate` must fall **within the current calendar month** (or the month the audit is being run for).

### 2. Close Date matches the month of sale
- `closedate` month/year = the month the sale actually happened. If the user gives a different "sale month," flag mismatch.

### 3. Qualified Lead with matching owner
- At least one associated contact exists.
- The contact was a Qualified Lead (check contact's lifecyclestage / lead status — surface the value and let the user confirm if the definition of "Qualified" is ambiguous).
- The contact's `hubspot_owner_id` equals the deal's `hubspot_owner_id`. Lead Owner and Deal Owner **must match**.

### 4. Activity logging
- The deal or its primary contact has logged evidence of **Meeting, Tour, Call, AND notes/activity**. Use `num_notes`, `num_contacted_notes`, `notes_last_contacted`, and the engagements API / associations to verify.
- A deal with zero meetings or zero tours logged is a `FAIL` — the club tour is a non-negotiable part of the Arcis sales motion.

### 5. Product line items
- `hs_num_of_associated_line_items >= 2`.
- Exactly one line item for **Initiation Fee (IF)** and one for **Dues**.
- If `member_offer` is anything other than `"Not applicable"`, the offer tag on the line item(s) must reflect it. The valid `member_offer` enum values are listed in the reference section below.

### 6. Executed application + IF deposit
- A file attachment exists that is clearly the signed & countersigned application.
- Evidence the IF deposit was collected and processed by the sales associate. If there is no note, receipt attachment, or payment confirmation, mark `NEEDS HUMAN REVIEW`.

### 7. Required documents attached (before moving to Closed Won)
All of the following must be attached to the deal:
- Application signed by **primary AND spouse** (if applicable).
- Application **countersigned by Arcis Golf** (the executed application).
- **Installment agreement** — only required if the member is on an installment plan. Infer from line item or deal notes.
- **Signed exception** by Sales Leader and MSO — only required if the deal has an exception (e.g., non-standard IF, non-standard offer, unusual terms). Infer from `member_offer` values like `"Contra 60/90 Days - Exception"` or from the deal notes.

### 8. Upgrade-specific rules (only if `dealtype = "Upgrade"` or pipeline = Upgrades)
- IF line item amount = (new IF) − (original IF). It should NOT be the full new IF.
- Dues line item amount = (new category dues) − (old category dues), for **one month** only.
- Deal type field is set to `Upgrade`.
- Deal notes explicitly mention the upgrade path (from/to categories).

### 9. Dashboard consistency
- The IF and Dues amounts on the HubSpot deal match what's recorded in the Arcis Golf Membership Dashboard. Claude Code cannot verify this directly — mark `NEEDS HUMAN REVIEW` and instruct the user to confirm weekly with the GM and Accountant.

### 10. Email address consistency
- The email on the Deal's primary contact, the application file, and what was entered in the Member Portal must all match. Compare the contact `email` against whatever email appears in attached application files / notes. If they differ, `FAIL`.

### 11. EzSuites / HubSpot record linkage
- Confirm (or surface) that the Membership Record from EzSuites is associated to the deal's contact in HubSpot. This typically shows up as a custom property or association on the contact. If you can't confirm, `NEEDS HUMAN REVIEW`.

### 12. Post-sale handoff to MRC
- A post-sales review note/task for the Member Relationship Coordinator (MRC) exists on the deal or contact with adequate onboarding info. Look in notes, tasks, and engagements. `NEEDS HUMAN REVIEW` if unclear.

### 13. Sign-offs (GM, Accountant, RVP)
- These are offline sign-offs. Do not attempt to auto-pass. Always surface as `NEEDS HUMAN REVIEW` with the deal's owner, amount, and club so the user can route to the right approvers.

### 14. Data hygiene — no red flags
- Scan for common mistakes: `amount` is zero or missing; `if_amount` is zero or missing when it shouldn't be; `closedate` is in the future; `dealtype` is blank; `hubspot_owner_id` is blank; description field contradicts the line items; `member_offer` is empty when an offer was clearly applied (e.g., deal name mentions "Offer" or the amount suggests discounting).

## Audit Report format

Output in this exact structure so reports are consistent across clubs and auditors:

```
ARCIS COMPENSABLE SALE AUDIT
Deal: <dealname> (<deal_id>)
Club / Pipeline: <pipeline_label>
Deal Owner: <owner_name>
Close Date: <closedate>
Amount: $<amount>  |  IF: $<if_amount>  |  Offer: <member_offer>
HubSpot URL: https://app.hubspot.com/contacts/24430029/record/0-3/<deal_id>

CHECKLIST RESULTS
 1. Closed Won before month end .............. [PASS | FAIL | REVIEW]  <1-line reason>
 2. Close Date matches month of sale ......... [...] <reason>
 3. Qualified Lead with matching owner ....... [...] <reason>
 4. Activity logging (Meet/Tour/Call/Notes) .. [...] <reason>
 5. Product line items (IF + Dues + Offer) ... [...] <reason>
 6. Executed application + IF deposit ........ [...] <reason>
 7. Required documents attached .............. [...] <reason>
 8. Upgrade rules (if applicable) ............ [N/A | PASS | FAIL | REVIEW]
 9. Dashboard consistency .................... [REVIEW] Verify with GM + Accountant
10. Email address consistency ................ [...] <reason>
11. EzSuites / HubSpot record linkage ........ [...] <reason>
12. Post-sale MRC handoff ................... [...] <reason>
13. GM / Accountant / RVP sign-offs .......... [REVIEW] Offline approval required
14. Data hygiene / red flags ................. [...] <reason>

VERDICT: <COMPENSABLE | NOT COMPENSABLE | PENDING HUMAN REVIEW>

ACTIONS REQUIRED TO BECOME COMPENSABLE
- <bulleted list of concrete fixes, each mapping to a checklist item number>
```

## Reference: Arcis HubSpot IDs

Claude Code can rely on these without re-querying every run. If HubSpot changes, these should be re-verified.

**Pipelines (`pipeline` property):**
- `29312913` — Membership
- `113039508` — Upgrades
- `29342096` — Tournament *(out of scope)*
- `83020073` — Subscriptions *(out of scope)*
- `148763975` — Card *(out of scope)*
- `708733980` — Actualized Events *(out of scope)*
- `default` — Private Event *(out of scope)*

**Deal stages for the Membership pipeline (`dealstage` property):**
- `66876082` — Appointment Scheduled
- `66876083` — Completed Club Tour
- `177054997` — Quote/Negotiation
- `66876086` — Application Sent
- `66876087` — **Closed Won** ← the target state
- `103546024` — Delayed/Deferred
- `66876088` — Closed Lost

**Deal types (`dealtype` property):**
- `newbusiness` — New Business
- `Rebooking` — Rebooking
- `Upgrade` — Upgrade *(triggers rule #8)*
- `Reinstate` — Former Member (Rejoining outside of 12 months)

**Current active `member_offer` values (enum — values that should appear on offer-tagged line items):**
Q4 2025 Offer, Q4 2024 Super Offer, Summer Three for Free, Summer On Us, Q1 2025 Winter Offer, New Referral Program, Pinery and Pradera IF Raise, Weston Hills IF Raise, Not applicable, Q4 2024 Winter Referral, Early Bird Winter Offer 2024, Swing Into Spring 2025, Contra 30 Days, Contra 60/90 Days - Exception, Former Member, Upgrade Offer, Competitor Offer, Champions Retreat- Atlanta National Membership Offer, Champions Retreat- Experience Offer, ATL Q4 2025 Fall Offer, New Year New Member Q4 2025, Fitness Dues until Nov, Social Dues, Comps Dues Until June 1, Spring on Us, Legacy YEX Financing.

Anything tagged `Contra 60/90 Days - Exception` **requires** a signed exception document (checklist item #7).

## HubSpot query patterns

Use the HubSpot MCP tools in this order:

1. `search_crm_objects` on `deals` with a filter for `dealname` (if searching by name) or `hs_object_id` (if by ID). Request the exact property set listed under **Properties to fetch**.
2. `search_crm_objects` on `contacts` with an `associatedWith` filter pointing at the deal ID to get associated contacts and their owner IDs.
3. `search_crm_objects` on `line_items` with an `associatedWith` filter pointing at the deal ID to enumerate IF/Dues/Offer line items.
4. If anything is missing, use `get_properties` with `propertyNames` to confirm a property exists before giving up on it.

## What Claude Code should NOT do

- Do not make up dashboard or EzSuites data — flag for human review.
- Do not audit deals outside the Membership or Upgrades pipelines.
