Campaign Details – UI Integration Guide

For the Growth Hacker App Foundation Module  
Using the Main App’s UI Style & Design System

---

## Overview

This guide covers the UI implementation for **Campaign Details** – one of the 7 categories in the Foundation Module. This section collects user‑provided campaign credentials (Access Token and Ad Account ID) required to pull ad performance data from platforms like Meta Ads, Google Ads, etc.

---

## UI Style Reference

The Growth Hacker App uses a dark theme with the following design tokens:

- **Background:** `#0a0f0c` (page), `#121a16` (cards), `#1a251f` (input fields)
- **Text:** `#e8eee9` (primary), `#8ba89b` (secondary), `#5a7265` (muted)
- **Accent:** `#4ade80` (green), `#facc15` (warning), `#f87171` (error)
- **Font:** Inter (Google Font)
- **Border radius:** 14px (cards), 10px (inputs), 100px (tags/badges)
- **Spacing:** consistent padding (20-24px) and gap (12-16px)

All components below use class names that already exist in the main app’s stylesheet – simply reuse them to maintain visual consistency.

---

## 1. Data Structure (TypeScript)

Extend the `manualInputs` section of `FoundationOutput`:

```typescript
interface ManualInputs {
  // Existing fields
  confirmedUSP: string | null;
  confirmedGoal: string | null;
  analyticsOAuthToken: string | null;
  competitorList: string[] | null;
  socialMedia: SocialMediaEntry[];
  competitors: CompetitorDetails;

  // NEW: Campaign Details
  campaign: CampaignDetails;
}

interface CampaignDetails {
  accessToken: string;      // OAuth access token for the ad platform
  adAccountId: string;      // Ad account identifier (e.g., "act_123456789")
}

2. API Endpoints

POST /api/foundation/analyze
Returns auto‑detected campaign data (if any). The frontend uses this to pre‑fill the UI.

PUT /api/foundation/manual
Saves user‑edited campaign details.

Request Body:

{
  "campaign": {
    "accessToken": "EAAB...",
    "adAccountId": "act_123456789"
  }
}

Response: { success: true, message: "Manual data saved." }

3. Campaign Details – UI Implementation

3.1 UI Design (Reusing Main App Styles)

┌──────────────────────────────────────────────────────────┐
│ 📊 Campaign Details                                     │
│ ──────────────────────────────────────────────────────── │
│                                                         │
│  Access Token    [•••••••••••••••••••••] [👁️]  ✓      │
│  Ad Account ID   [act_123456789              ]  ✓      │
│                                                         │
│  💡 Insight: Campaign credentials are set. You can      │
│     now pull ad performance data.                       │
│                                                         │
│  [Save Changes]                                         │
└──────────────────────────────────────────────────────────┘

Access Token is a password field with a show/hide toggle.
Ad Account ID is a plain text field.
A green checkmark appears when a field has a value.
The insight box provides guidance based on completion status.
3.2 Component Code (React)

The following component uses classes like .platform-row, .badge, .btn-save, and .pw-toggle – all defined in the main app’s CSS.

import React, { useState } from 'react';

interface CampaignDetails {
  accessToken: string;
  adAccountId: string;
}

interface CampaignSectionProps {
  initialData?: { campaign?: CampaignDetails };
  onSave: (data: CampaignDetails) => void;
}

function CampaignSection({ initialData, onSave }: CampaignSectionProps) {
  const [accessToken, setAccessToken] = useState(initialData?.campaign?.accessToken || '');
  const [adAccountId, setAdAccountId] = useState(initialData?.campaign?.adAccountId || '');
  const [showToken, setShowToken] = useState(false);

  const handleSave = () => {
    const token = accessToken.trim();
    const account = adAccountId.trim();
    if (!token || !account) {
      alert('Both Access Token and Ad Account ID are required.');
      return;
    }
    onSave({ accessToken: token, adAccountId: account });
  };

  const isComplete = accessToken.trim() !== '' && adAccountId.trim() !== '';

  return (
    <div className="campaign-section card">
      <div className="card-header">
        <h3>📊 Campaign Details</h3>
        <span className="badge-count">
          {isComplete ? '✅ Ready' : '⏳ Incomplete'}
        </span>
      </div>

      <div className="platform-list">
        {/* Access Token */}
        <div className="platform-row">
          <label>Access Token</label>
          <input
            type={showToken ? 'text' : 'password'}
            placeholder="Enter your access token…"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
          <button
            className="pw-toggle"
            onClick={() => setShowToken(!showToken)}
          >
            {showToken ? '🙈' : '👁️'}
          </button>
          <span className={`badge ${accessToken ? 'verified' : 'muted'}`}>
            {accessToken ? '✓' : '—'}
          </span>
        </div>

        {/* Ad Account ID */}
        <div className="platform-row">
          <label>Ad Account ID</label>
          <input
            type="text"
            placeholder="e.g. act_123456789"
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
          />
          <span className={`badge ${adAccountId ? 'verified' : 'muted'}`}>
            {adAccountId ? '✓' : '—'}
          </span>
        </div>
      </div>

      <div className="insight-box">
        <p>
          <strong>💡 Insight: </strong>
          {isComplete
            ? 'Campaign credentials are set. You can now pull ad performance data.'
            : 'Please provide both Access Token and Ad Account ID to enable campaign analytics.'}
        </p>
      </div>

      <button className="btn-save" onClick={handleSave}>
        Save Changes
      </button>
    </div>
  );
}

export default CampaignSection;

3.3 CSS Additions (Reuse existing, plus new toggle button)

The main app already has styles for .platform-row, .badge, .btn-save, etc.
Add the following for the password toggle:

.pw-toggle {
  background: none;
  border: none;
  color: #5a7265;
  cursor: pointer;
  font-size: 16px;
  padding: 0 8px;
  flex-shrink: 0;
}
.pw-toggle:hover {
  color: #8ba89b;
}

4. User Flow Summary

Page Load → Fetch auto‑detected campaign data from backend; pre‑fill fields if available.
User Edits → Enter/update Access Token and Ad Account ID; real‑time validation (non‑empty).
Save → On click, validate both fields are non‑empty, then send PUT request to /api/foundation/manual.
Confirmation → Show success message and update insight.
5. Validation Rules

Access Token: Must be non‑empty (can be any string, as it’s an opaque token).
Ad Account ID: Must be non‑empty; optionally enforce a format like act_ prefix if required by the platform.
Both fields are required to enable campaign features.
6. Integration with Main App

The CampaignSection component is designed to be dropped into the existing Foundation page, alongside SocialMediaSection and CompetitorSection. It uses the same CSS classes and design tokens.

Example Parent Usage

function FoundationPage() {
  const [manualData, setManualData] = useState({});

  const handleCampaignSave = (campaign) => {
    fetch('/api/foundation/manual', {
      method: 'PUT',
      body: JSON.stringify({ campaign }),
      headers: { 'Content-Type': 'application/json' }
    }).then(() => setManualData(prev => ({ ...prev, campaign })));
  };

  return (
    <div className="foundation-page">
      <SocialMediaSection ... />
      <CompetitorSection ... />
      <CampaignSection
        initialData={manualData}
        onSave={handleCampaignSave}
      />
    </div>
  );
}

7. Testing Checklist

#	Test Case	Expected
1	Access Token input shows as password by default	Yes
2	Clicking toggle shows/hides the token	Yes
3	Entering a token updates the badge to green check	Yes
4	Entering an Ad Account ID updates badge to green check	Yes
5	Both fields filled → insight says “credentials are set”	Yes
6	One or both fields empty → insight says “provide both”	Yes
7	Save with both fields empty → alert / validation error	Yes
8	Save with both fields filled → success toast and API call	Yes
9	Reload page → previously saved data still present	Yes
8. Implementation Timeline

Task	Estimated Time
Define interfaces	15 min
Campaign component (React)	1 hour
Validation & insights	30 min
API integration	30 min
Testing & polish	1 hour
Total	~3.25 hours
9. Summary

The Campaign Details section collects the user’s Access Token and Ad Account ID.
It is implemented as a self‑contained React component using the main app’s existing dark‑theme styles.
Validation ensures both fields are non‑empty before saving.
Data is persisted via the /api/foundation/manual endpoint.
The component provides visual feedback through badges and an insight box, improving user experience.
End of Document