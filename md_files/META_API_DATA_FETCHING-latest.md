# Meta API Integration - Data Fetching Guide

## Overview

The analyzer module fetches real campaign data from **Meta Marketing API v23.0** to generate 25 actionable items.

---

## API Credentials Required

```
accessToken: User access token with ads:read permission
adAccountId: Ad account ID (format: 1234567890, not act_1234567890)
apiVersion: v23.0 or higher
```

---

## Meta API Base URL

```
https://graph.facebook.com/v23.0/
```

---

## 4 Required API Endpoints

### 1. Get Campaigns

**Endpoint:**
```
GET https://graph.facebook.com/v23.0/act_{adAccountId}/campaigns
```

**Parameters:**
```
fields: id,name,objective,status,daily_budget
access_token: {accessToken}
```

**Example Request:**
```bash
curl -G \
  -d "fields=id,name,objective,status,daily_budget" \
  -d "access_token=YOUR_ACCESS_TOKEN" \
  "https://graph.facebook.com/v23.0/act_1234567890/campaigns"
```

**Example Response:**
```json
{
  "data": [
    {
      "id": "123456789",
      "name": "Q1 Growth Campaign",
      "objective": "LINK_CLICKS",
      "status": "ACTIVE",
      "daily_budget": 500000
    },
    {
      "id": "987654321",
      "name": "Lead Generation",
      "objective": "LEAD_GENERATION",
      "status": "PAUSED",
      "daily_budget": 300000
    }
  ],
  "paging": {
    "cursors": {
      "before": "...",
      "after": "..."
    }
  }
}
```

**What Each Field Means:**
- `id`: Campaign ID (use for insights call)
- `name`: Campaign name (display in items)
- `objective`: Campaign goal (LINK_CLICKS, CONVERSIONS, etc.)
- `status`: ACTIVE, PAUSED, DELETED, ARCHIVED
- `daily_budget`: Daily budget in cents (divide by 100 for dollars)

**Used By Items:**
- Items 1, 6, 7, 8, 9, 10, 11, 12

---

### 2. Get Campaign Insights (MOST IMPORTANT)

**Endpoint:**
```
GET https://graph.facebook.com/v23.0/act_{adAccountId}/insights
```

**Parameters:**
```
level: campaign
date_preset: last_7d
fields: campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions
access_token: {accessToken}
```

**Example Request:**
```bash
curl -G \
  -d "level=campaign" \
  -d "date_preset=last_7d" \
  -d "fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions" \
  -d "access_token=YOUR_ACCESS_TOKEN" \
  "https://graph.facebook.com/v23.0/act_1234567890/insights"
```

**Example Response:**
```json
{
  "data": [
    {
      "campaign_id": "123456789",
      "campaign_name": "Q1 Growth Campaign",
      "spend": "8500.50",
      "impressions": 125000,
      "clicks": 1850,
      "ctr": "1.48",
      "cpc": "4.59",
      "cpm": "68.00",
      "frequency": "2.3",
      "reach": 54321,
      "actions": 95
    }
  ],
  "paging": {
    "cursors": {
      "before": "...",
      "after": "..."
    }
  }
}
```

**What Each Field Means:**
- `campaign_id`: Links to campaign (join with campaigns list)
- `campaign_name`: Display name
- `spend`: Total spend in dollars (string, can have decimals)
- `impressions`: Total impressions (number)
- `clicks`: Total clicks (number)
- `ctr`: Click-through rate percentage (string, e.g., "1.48")
- `cpc`: Cost per click in dollars (string, e.g., "4.59")
- `cpm`: Cost per 1000 impressions (string, e.g., "68.00")
- `frequency`: Average impressions per person (string, e.g., "2.3")
- `reach`: Unique people reached (number)
- `actions`: Conversions/purchases (number)

**Date Presets Available:**
```
last_7d      - Last 7 days (RECOMMENDED)
last_28d     - Last 28 days
last_30d     - Last 30 days
last_90d     - Last 90 days
this_month   - Calendar month to date
this_quarter - Calendar quarter to date
this_year    - Calendar year to date
lifetime     - All time
```

**Used By Items:**
- ALL 25 items depend on insights data

---

### 3. Get Ad Sets (Optional - for deeper analysis)

**Endpoint:**
```
GET https://graph.facebook.com/v23.0/act_{adAccountId}/adsets
```

**Parameters:**
```
fields: id,name,campaign_id,daily_budget,status
access_token: {accessToken}
```

**Example Request:**
```bash
curl -G \
  -d "fields=id,name,campaign_id,daily_budget,status" \
  -d "access_token=YOUR_ACCESS_TOKEN" \
  "https://graph.facebook.com/v23.0/act_1234567890/adsets"
```

**Used By Items:**
- Items 6, 7, 18 (for detailed budget analysis)

---

### 4. Get Ads (Optional - for creative analysis)

**Endpoint:**
```
GET https://graph.facebook.com/v23.0/act_{adAccountId}/ads
```

**Parameters:**
```
fields: id,name,adset_id,status,creative
access_token: {accessToken}
```

**Used By Items:**
- Items 2, 23 (for creative format analysis)

---

## API Authentication

### Method 1: Direct Access Token (Recommended for backend)

```
Add to every request:
?access_token={accessToken}
```

**Requirements:**
- Access token with `ads_read` permission
- From Business Account
- Must be valid (not expired)

### Method 2: Bearer Token (Alternative)

```
Authorization: Bearer {accessToken}
```

---

## Error Handling

### Common Errors

**1. Invalid Token**
```json
{
  "error": {
    "message": "Invalid OAuth access token.",
    "type": "OAuthException",
    "code": 190
  }
}
```

**Fix:** Request new token or refresh

---

**2. Invalid Account ID**
```json
{
  "error": {
    "message": "Campaign with ID X does not exist",
    "type": "GraphMethodException",
    "code": 100
  }
}
```

**Fix:** Verify correct account ID format (no `act_` prefix)

---

**3. Insufficient Permissions**
```json
{
  "error": {
    "message": "User does not have permission to access Campaign",
    "type": "OAuthException",
    "code": 200
  }
}
```

**Fix:** Grant `ads_read` permission to token

---

**4. Rate Limited**
```json
{
  "error": {
    "message": "Please reduce the amount of data you're asking for",
    "type": "OAuthException",
    "code": 17
  }
}
```

**Fix:** Wait before next request, or paginate results

---

## Implementation Code Examples

### JavaScript/Node.js

```javascript
// Fetch campaigns
async function fetchCampaigns(accessToken, adAccountId) {
  const url = new URL('https://graph.facebook.com/v23.0/act_' + adAccountId + '/campaigns');
  url.searchParams.append('fields', 'id,name,objective,status,daily_budget');
  url.searchParams.append('access_token', accessToken);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.data;
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    throw error;
  }
}

// Fetch insights
async function fetchInsights(accessToken, adAccountId) {
  const url = new URL('https://graph.facebook.com/v23.0/act_' + adAccountId + '/insights');
  url.searchParams.append('level', 'campaign');
  url.searchParams.append('date_preset', 'last_7d');
  url.searchParams.append('fields', 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions');
  url.searchParams.append('access_token', accessToken);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.data;
  } catch (error) {
    console.error('Error fetching insights:', error);
    throw error;
  }
}

// Complete data fetch function
async function fetchAllData(accessToken, adAccountId) {
  try {
    const campaigns = await fetchCampaigns(accessToken, adAccountId);
    const insights = await fetchInsights(accessToken, adAccountId);

    // Map insights by campaign ID
    const insightsMap = {};
    insights.forEach(insight => {
      insightsMap[insight.campaign_id] = insight;
    });

    return {
      campaigns,
      insights: insightsMap
    };
  } catch (error) {
    console.error('Error fetching all data:', error);
    throw error;
  }
}

// Usage
const data = await fetchAllData(accessToken, adAccountId);
console.log(data.campaigns);      // Array of campaigns
console.log(data.insights);       // Object with campaign_id as key
```

---

### Python Example

```python
import requests

def fetch_campaigns(access_token, ad_account_id):
    url = f"https://graph.facebook.com/v23.0/act_{ad_account_id}/campaigns"
    params = {
        'fields': 'id,name,objective,status,daily_budget',
        'access_token': access_token
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    if 'error' in data:
        raise Exception(data['error']['message'])
    
    return data.get('data', [])

def fetch_insights(access_token, ad_account_id):
    url = f"https://graph.facebook.com/v23.0/act_{ad_account_id}/insights"
    params = {
        'level': 'campaign',
        'date_preset': 'last_7d',
        'fields': 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions',
        'access_token': access_token
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    if 'error' in data:
        raise Exception(data['error']['message'])
    
    return data.get('data', [])

# Usage
campaigns = fetch_campaigns(access_token, ad_account_id)
insights = fetch_insights(access_token, ad_account_id)
```

---

## Rate Limits

**Meta API Rate Limits:**
```
200 calls per hour per token
600 calls per 600 seconds per token
```

**How to Handle:**
```
1. Batch requests - Get all data in 1-2 calls
2. Implement exponential backoff for retries
3. Cache results for 1 hour
4. Don't call API on every request
```

**Retry Strategy:**
```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.error) {
        if (data.error.code === 17) { // Rate limited
          const delay = Math.pow(2, i) * 1000; // Exponential backoff
          await sleep(delay);
          continue;
        }
        throw new Error(data.error.message);
      }
      
      return data;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000;
      await sleep(delay);
    }
  }
}
```

---

## Data Type Conversions

**When processing insights data:**

```javascript
// String to Number
spend = parseFloat(insight.spend)          // "8500.50" → 8500.50
ctr = parseFloat(insight.ctr)              // "1.48" → 1.48
cpc = parseFloat(insight.cpc)              // "4.59" → 4.59
cpm = parseFloat(insight.cpm)              // "68.00" → 68.00
frequency = parseFloat(insight.frequency)  // "2.3" → 2.3

// Already Numbers
impressions = insight.impressions          // 125000
clicks = insight.clicks                    // 1850
reach = insight.reach                      // 54321
actions = insight.actions                  // 95

// String to Number (from campaigns)
daily_budget_cents = campaign.daily_budget // 500000 cents
daily_budget_usd = daily_budget_cents / 100 // $5000
```

---

## Complete Module Flow

```
1. VALIDATE TOKEN
   └─ GET /v23.0/me
      └─ Check if token is valid
   
2. FETCH CAMPAIGNS
   └─ GET /v23.0/act_{id}/campaigns
      └─ Get campaign list with metadata
   
3. FETCH INSIGHTS
   └─ GET /v23.0/act_{id}/insights
      └─ Get 7-day performance metrics
   
4. MERGE DATA
   └─ Combine campaigns + insights by campaign_id
      └─ Create complete campaign objects
   
5. CALCULATE METRICS
   └─ Sum and average across all campaigns
      └─ Calculate CTR, CPC, CPM, etc.
   
6. GENERATE 25 ITEMS
   └─ Use metrics to generate actionable items
      └─ Apply logic from specification
   
7. RETURN RESULTS
   └─ Return metrics + 25 items to API
      └─ Send to client/frontend
```

---

## Caching Strategy

**Cache results to reduce API calls:**

```javascript
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

async function getAnalysisData(accessToken, accountId) {
  const cacheKey = `${accountId}`;
  const cached = cache.get(cacheKey);
  
  // Return cached if exists and fresh
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  // Fetch from API
  const data = await fetchAllData(accessToken, accountId);
  
  // Store in cache
  cache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  return data;
}
```

---

## Validation Checklist

Before calling API:

```
✅ accessToken exists and is valid
✅ adAccountId is in correct format (no act_ prefix)
✅ Token has ads:read permission
✅ Token is not expired
✅ API endpoint URL is correct (v23.0)
✅ All required fields are in request
✅ Parameters are properly formatted
✅ Error handling is in place
✅ Retry logic is implemented
✅ Rate limiting is considered
```

---

## Quick Reference

| Action | Endpoint | Method | Key Fields |
|--------|----------|--------|-----------|
| Get Campaigns | `/act_{id}/campaigns` | GET | id, name, objective, status, daily_budget |
| Get Insights | `/act_{id}/insights` | GET | spend, impressions, clicks, ctr, cpc, cpm |
| Get Ad Sets | `/act_{id}/adsets` | GET | id, name, campaign_id, daily_budget |
| Get Ads | `/act_{id}/ads` | GET | id, name, adset_id, status, creative |

---

## Testing the API

### Test with real token:

```bash
# Test token validity
curl "https://graph.facebook.com/v23.0/me?access_token=YOUR_TOKEN"

# Test campaigns fetch
curl "https://graph.facebook.com/v23.0/act_1234567890/campaigns?fields=id,name&access_token=YOUR_TOKEN"

# Test insights fetch
curl "https://graph.facebook.com/v23.0/act_1234567890/insights?level=campaign&date_preset=last_7d&fields=campaign_id,spend,impressions&access_token=YOUR_TOKEN"
```

---

## Summary

**The analyzer module:**

1. ✅ Uses Meta API v23.0
2. ✅ Calls 2-4 endpoints (campaigns, insights, optionally ads + adsets)
3. ✅ Fetches 7-day performance data
4. ✅ Calculates metrics from raw data
5. ✅ Generates 25 actionable items based on metrics
6. ✅ Returns JSON to API/client

**Ready to integrate with your API!** 🚀

