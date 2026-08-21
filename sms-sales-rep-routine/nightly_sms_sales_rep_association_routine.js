/**
 * NIGHTLY ROUTINE: Associate SMS Communications to Sales Reps
 * -----------------------------------------------------------------
 * Intended to run once daily as a Claude Code Routine (or any cron-
 * style scheduler outside HubSpot workflows). No execution time
 * ceiling, so it fully paginates and fully resolves each night's
 * batch rather than relying on multiple runs to catch up.
 *
 * Given real SMS volume can run into the thousands per day, this
 * script uses the same safeguards as the backfill:
 *   - Recursively splits the time window so no single search query
 *     approaches HubSpot's 10,000-result cap.
 *   - Runs splits SEQUENTIALLY with a small throttle delay to avoid
 *     tripping HubSpot's per-second rate limit.
 *   - Retries automatically with exponential backoff on 429s.
 *
 * WINDOW LOGIC
 *   Looks back LOOKBACK_HOURS (default 26) from "now" at run time.
 *   The extra buffer beyond 24 hours protects against clock drift,
 *   late-arriving records, or a missed/delayed run the night before.
 *   Idempotent (skips already-associated records), so the overlap
 *   is free — no risk of duplicate associations.
 *
 * SETUP
 *   npm install @hubspot/api-client
 *   export PRIVATE_APP_TOKEN=your-token-here
 *   Schedule to run once daily, e.g. 2:00 AM Central.
 *   Optionally override the window with LOOKBACK_HOURS=<n> for a
 *   one-off backfill (e.g. LOOKBACK_HOURS=72 npm start). Safe to
 *   widen since the run is idempotent.
 *
 * OUTPUT
 *   Logs a JSON summary to stdout. If you want this written to
 *   Notion or HubDB alongside your other daily jobs, add a write
 *   step at the end of main() using the same pattern as your lead
 *   dashboard job.
 */

const hubspot = require('@hubspot/api-client');

const LOOKBACK_HOURS = process.env.LOOKBACK_HOURS ? Number(process.env.LOOKBACK_HOURS) : 26;
const SALES_REP_OBJECT = 'p24430029_sales_reps';
const COMMUNICATIONS_TO_SALES_REP_ASSOC_TYPE_ID = 263;
const SEARCH_PAGE_SIZE = 100;
const BATCH_CHUNK_SIZE = 100;
const SAFE_WINDOW_LIMIT = 9000; // stay comfortably under HubSpot's 10,000-result search cap
const THROTTLE_MS = 350;
const MAX_RETRIES = 8;
const RETRY_BASE_DELAY_MS = 1000;

const hubspotClient = new hubspot.Client({
  accessToken: process.env.PRIVATE_APP_TOKEN
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function isRateLimitError(err) {
  const msg = err?.message || '';
  return /HTTP-Code: 429/.test(msg) || /RATE_LIMIT/i.test(msg) || /secondly limit/i.test(msg);
}

async function withRateLimitHandling(fn) {
  let attempt = 0;
  while (true) {
    await sleep(THROTTLE_MS);
    try {
      return await fn();
    } catch (err) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        attempt++;
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

function buildSmsFilters(startMs, endMs) {
  return [{
    filters: [
      { propertyName: 'hs_communication_channel_type', operator: 'EQ', value: 'SMS' },
      { propertyName: 'hubspot_owner_id', operator: 'HAS_PROPERTY' },
      { propertyName: 'hs_createdate', operator: 'GTE', value: startMs },
      { propertyName: 'hs_createdate', operator: 'LT', value: endMs }
    ]
  }];
}

async function getWindowTotal(startMs, endMs) {
  const resp = await withRateLimitHandling(() =>
    hubspotClient.crm.objects.searchApi.doSearch(
      'communications',
      {
        filterGroups: buildSmsFilters(startMs, endMs),
        limit: 1,
        properties: ['hubspot_owner_id']
      }
    )
  );
  return resp.total;
}

async function paginateWindow(startMs, endMs) {
  const records = [];
  let after = undefined;

  do {
    const searchResp = await withRateLimitHandling(() =>
      hubspotClient.crm.objects.searchApi.doSearch(
        'communications',
        {
          filterGroups: buildSmsFilters(startMs, endMs),
          sorts: [{ propertyName: 'hs_createdate', direction: 'ASCENDING' }],
          limit: SEARCH_PAGE_SIZE,
          after,
          properties: ['hubspot_owner_id', 'hs_createdate']
        }
      )
    );
    records.push(...searchResp.results);
    after = searchResp.paging?.next?.after;
  } while (after);

  return records;
}

async function fetchWindowRecords(startMs, endMs) {
  if (endMs - startMs < 1000) {
    return [];
  }

  const total = await getWindowTotal(startMs, endMs);

  if (total > SAFE_WINDOW_LIMIT) {
    const midMs = Math.floor((startMs + endMs) / 2);
    const left = await fetchWindowRecords(startMs, midMs);
    const right = await fetchWindowRecords(midMs, endMs);
    return left.concat(right);
  }

  return paginateWindow(startMs, endMs);
}

async function fetchRecentSmsRecords(cutoffMs) {
  const nowMs = Date.now();
  return fetchWindowRecords(cutoffMs, nowMs);
}

async function batchReadAssociations(commIds) {
  const alreadyAssociatedIds = new Set();

  for (const idsChunk of chunk(commIds, BATCH_CHUNK_SIZE)) {
    const raw = await withRateLimitHandling(() =>
      hubspotClient.apiRequest({
        method: 'POST',
        path: `/crm/v4/associations/communications/${SALES_REP_OBJECT}/batch/read`,
        body: { inputs: idsChunk.map(id => ({ id })) }
      })
    );

    if (!raw.ok) {
      const errBody = await raw.text();
      throw new Error(`Association batch read failed (${raw.status}): ${errBody}`);
    }

    const parsed = await raw.json();
    (parsed.results || [])
      .filter(r => r.to && r.to.length > 0)
      .forEach(r => alreadyAssociatedIds.add(r.from.id));
  }

  return alreadyAssociatedIds;
}

async function searchRepsByOwnerIds(ownerIds) {
  const ownerIdToRepId = new Map();

  for (const ownerIdsChunk of chunk(ownerIds, BATCH_CHUNK_SIZE)) {
    const repSearch = await withRateLimitHandling(() =>
      hubspotClient.crm.objects.searchApi.doSearch(
        SALES_REP_OBJECT,
        {
          filterGroups: [{
            filters: [{
              propertyName: 'hubspot_user_id',
              operator: 'IN',
              values: ownerIdsChunk
            }]
          }],
          limit: BATCH_CHUNK_SIZE,
          properties: ['hubspot_user_id']
        }
      )
    );

    repSearch.results.forEach(rep => {
      ownerIdToRepId.set(rep.properties.hubspot_user_id, rep.id);
    });
  }

  return ownerIdToRepId;
}

async function batchCreateAssociations(toCreate) {
  let created = 0;

  for (const inputsChunk of chunk(toCreate, BATCH_CHUNK_SIZE)) {
    const raw = await withRateLimitHandling(() =>
      hubspotClient.apiRequest({
        method: 'POST',
        path: `/crm/v4/associations/communications/${SALES_REP_OBJECT}/batch/create`,
        body: { inputs: inputsChunk }
      })
    );

    if (!raw.ok) {
      const errBody = await raw.text();
      throw new Error(`Association batch create failed (${raw.status}): ${errBody}`);
    }

    await raw.json();
    created += inputsChunk.length;
  }

  return created;
}

async function main() {
  if (!process.env.PRIVATE_APP_TOKEN) {
    console.error('Missing PRIVATE_APP_TOKEN environment variable.');
    process.exit(1);
  }

  const results = {
    run_at: new Date().toISOString(),
    lookback_hours: LOOKBACK_HOURS,
    processed: 0,
    associated: 0,
    skipped_already_associated: 0,
    no_owner: 0,
    no_rep_match: 0,
    unmatched_owner_ids: []
  };

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - LOOKBACK_HOURS);
  const cutoffMs = cutoff.getTime();

  const records = await fetchRecentSmsRecords(cutoffMs);
  results.processed = records.length;

  if (records.length === 0) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const alreadyAssociatedIds = await batchReadAssociations(records.map(r => r.id));

  const needsProcessing = records.filter(r => {
    if (alreadyAssociatedIds.has(r.id)) {
      results.skipped_already_associated++;
      return false;
    }
    if (!r.properties.hubspot_owner_id) {
      results.no_owner++;
      return false;
    }
    return true;
  });

  if (needsProcessing.length === 0) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const uniqueOwnerIds = [...new Set(needsProcessing.map(r => r.properties.hubspot_owner_id))];
  const ownerIdToRepId = await searchRepsByOwnerIds(uniqueOwnerIds);

  const unmatchedOwnerIds = new Set();
  const toCreate = [];
  for (const record of needsProcessing) {
    const repId = ownerIdToRepId.get(record.properties.hubspot_owner_id);
    if (!repId) {
      results.no_rep_match++;
      unmatchedOwnerIds.add(record.properties.hubspot_owner_id);
      continue;
    }
    toCreate.push({
      from: { id: record.id },
      to: { id: repId },
      types: [{ associationCategory: 'USER_DEFINED', associationTypeId: COMMUNICATIONS_TO_SALES_REP_ASSOC_TYPE_ID }]
    });
  }

  if (toCreate.length > 0) {
    results.associated = await batchCreateAssociations(toCreate);
  }

  results.unmatched_owner_ids = [...unmatchedOwnerIds];

  console.log(JSON.stringify(results, null, 2));

  // OPTIONAL: write `results` to Notion/HubDB here, matching the
  // pattern used by the daily lead dashboard routine, if you want
  // this summary tracked alongside your other scheduled jobs.
}

main().catch(err => {
  console.error('Nightly routine failed:', err.message);
  process.exit(1);
});
