# Meta Ads Analyzer - Complete Technical Documentation

## Overview
Meta Ads Analyzer is a comprehensive platform for analyzing Meta advertising campaigns, content strategy planning, and direct posting to Facebook and Instagram. The tool integrates Meta's Marketing API and Graph API to provide real-time campaign insights and enables direct content publication.

---

## 1. Meta APIs Used

### Core APIs
| API | Purpose | Version |
|-----|---------|---------|
| Meta Graph API | Campaign data, insights, posts retrieval | v23.0 |
| Meta Marketing API | Campaign creation, ad set management, ad creation | v23.0 |
| Meta Graph API Feed Endpoint | Direct posting to Facebook | v23.0 |
| Instagram Graph API | Media retrieval and publishing | v23.0 |

### Endpoints Utilized

#### Campaign Management
- `GET /act_{ad_account_id}/campaigns` - Retrieve all campaigns
- `GET /act_{ad_account_id}/insights` - Get campaign performance metrics
- `POST /act_{ad_account_id}/campaigns` - Create new campaigns

#### Ad Sets
- `GET /act_{ad_account_id}/adsets` - Retrieve ad sets
- `POST /act_{ad_account_id}/adsets` - Create ad sets

#### Ads
- `GET /act_{ad_account_id}/ads` - Retrieve individual ads
- `POST /act_{ad_account_id}/ads` - Create ads

#### Facebook Posts
- `GET /{page_id}/posts` - Retrieve existing posts
- `POST /{page_id}/feed` - **Direct posting to Facebook**

#### Instagram Media
- `GET /{instagram_account_id}/media` - Retrieve Instagram media
- `POST /{instagram_account_id}/media_publish` - **Direct publishing to Instagram**

#### Authentication
- `GET /me` - Token validation endpoint

---

## 2. Required Credentials & Permissions

### Meta Access Token Requirements
- **Type:** User Access Token or Page Access Token
- **Minimum Permissions Required:**
  - `ads_management`
  - `campaigns_read`
  - `pages_read_engagement`
  - `pages_manage_posts`
  - `instagram_basic`
  - `instagram_content_publish`

### Input Fields
```
1. Meta Access Token (required) - User's authenticated token
2. Ad Account ID (required) - Ad account identifier (without 'act_' prefix)
3. Facebook Page ID (optional) - For post retrieval and publishing
4. Instagram Account ID (optional) - For Instagram posting
5. Industry/Niche (required) - For content recommendations (E-commerce, SaaS, Health & Wellness, Education)
```

---

## 3. Data Retrieved & Displayed

### Campaign Performance Tab
**Data Points Displayed:**
- Campaign Name
- Campaign Status (Active/Paused)
- Spend (7-day)
- Impressions
- Reach
- Click-Through Rate (CTR %)
- Cost Per Click (CPC)
- Cost Per Thousand Impressions (CPM)
- Objective Type

**Summary Metrics:**
- Total Active Campaigns (count)
- Total Spend (7-day aggregated)
- Total Impressions (7-day aggregated)
- Total Clicks (7-day aggregated)

**Data Source:** `insights` endpoint with `date_preset=last_7d`

---

### Content Strategy Tab

#### 1. Content Gap Analysis
**What it Shows:**
- Campaign objectives not yet tested (e.g., REACH, TRAFFIC, CONVERSIONS, APP_INSTALLS, VIDEO_VIEWS, LEAD_GENERATION)
- Identified opportunities for campaign diversification
- Gap severity recommendations

**Calculation:** Compares current campaign objectives against all available Meta objective types

#### 2. Caption Ideas (5 Pre-written Captions)
**What it Shows:**
- Action-ready post captions optimized for the selected niche
- Call-to-action examples
- Emoji integration for engagement
- Variations for different content types

**Niche-Specific:** Each niche (E-commerce, SaaS, Health & Wellness, Education) has tailored captions

#### 3. Hashtag Research
**What it Shows:**
- 12 relevant hashtags per niche
- Trending hashtags in the industry
- One-click copy functionality
- Hashtag strategy recommendations

**Display:** Hashtag grid with clickable tiles for easy copying

#### 4. Content Categories
**What it Shows:**
- Recommended content distribution percentages
- 5-6 category types per niche with allocation %
- Example: E-commerce (40% Product Showcases, 20% Testimonials, 20% Promotions, 15% Guides, 5% Behind-the-Scenes)

**Purpose:** Content planning and consistency

#### 5. Content Calendar
**What it Shows:**
- 7-day posting schedule
- Optimal posting times for each day
- Content type for each post
- Post frequency recommendations (5 posts per week)

**Time Optimization:** Based on general audience behavior patterns

---

### Content Calendar Tab
**Visual Display:**
- Week-at-a-glance grid (7 days)
- Scheduled post days highlighted
- Rest days marked
- Recommended posting times
- Weekly content mix breakdown (percentages by type)

**Export:** Available as part of full report export

---

### Ad Creative Review Tab
**Performance Analysis:**
- Ad Name
- Creative Title
- Creative Body Text
- Creative Performance Score (0-100)
- Strengths (3-4 identified strengths)
- Improvement Areas (3-4 recommendations)

**Expert Recommendations:**
- Video creative performance tips
- Face usage in ads best practices
- Copy length optimization
- A/B testing strategies
- Urgency/scarcity messaging impact

**Data Source:** Ad creative data from `ads` endpoint with creative details

---

## 4. Budget & Spend Tracking

### Spend Metrics Displayed
| Metric | Frequency | Time Period | Source |
|--------|-----------|-------------|--------|
| Campaign Spend | Real-time | Last 7 days | insights endpoint |
| Daily Budget (if set) | On load | Current | campaigns endpoint |
| Lifetime Budget (if set) | On load | Campaign life | campaigns endpoint |
| Ad Set Budget | On load | Current | adsets endpoint |
| Cost Per Action | Real-time | Last 7 days | insights endpoint |
| Total Account Spend | Real-time | Last 7 days | Aggregated from all campaigns |

### Budget Visualization
- Individual campaign spend display
- Total account spend summary card
- CPC and CPM metrics for cost efficiency
- Spend comparison across campaigns

### Budget Control
- **Not editable** in this version (view-only)
- Can be edited through additional "Modify Campaign" feature
- Budget changes propagate through insights in real-time

---

## 5. Posting Capabilities

### Facebook Direct Posting
**Endpoint:** `POST /graph.facebook.com/v23.0/{page_id}/feed`

**What Can Be Posted:**
- Text messages
- Links
- Images
- Videos
- Scheduled posts (future date)

**Posting Parameters:**
```json
{
  "message": "Your post text",
  "link": "https://example.com (optional)",
  "picture": "image_url (optional)",
  "name": "Link title (optional)",
  "caption": "Link description (optional)"
}
```

**Response:** Returns post ID upon successful posting

**Results Shown:**
- Post ID confirmation
- Success/error message
- Timestamp of posting
- Direct link to post on Facebook

---

### Instagram Direct Posting
**Endpoint:** `POST /graph.facebook.com/v23.0/{instagram_account_id}/media_publish`

**What Can Be Posted:**
- Images (JPEG, PNG)
- Video content
- Carousel posts (multiple images)
- Reels

**Posting Parameters:**
```json
{
  "creation_id": "content_creation_id",
  "caption": "Your caption text",
  "media_type": "IMAGE|CAROUSEL|VIDEO|REELS",
  "user_tags": []
}
```

**Response:** Returns Instagram post ID and publish status

**Results Shown:**
- Instagram post ID
- Publish confirmation
- Caption confirmation
- Media type confirmation

---

### Create Campaign from Dashboard
**Endpoint:** `POST /act_{ad_account_id}/campaigns`

**Parameters:**
```json
{
  "name": "Campaign name",
  "objective": "REACH|TRAFFIC|CONVERSIONS|APP_INSTALLS|VIDEO_VIEWS|LEAD_GENERATION",
  "status": "PAUSED|ACTIVE",
  "special_ad_categories": []
}
```

**Results Shown:**
- New campaign ID
- Campaign creation confirmation
- Objective confirmation
- Initial status

---

### Create Ad Set from Dashboard
**Endpoint:** `POST /act_{ad_account_id}/adsets`

**Parameters:**
```json
{
  "name": "Ad set name",
  "campaign_id": "campaign_id",
  "daily_budget": "amount_in_cents",
  "billing_event": "IMPRESSIONS|CLICKS|ACTIONS",
  "optimization_goal": "REACH|CLICKS|ACTIONS|PURCHASES|LEAD_GENERATION",
  "targeting": {
    "geo_locations": {"countries": ["US"]},
    "age_min": 18,
    "age_max": 65
  }
}
```

**Results Shown:**
- Ad set ID
- Budget confirmation
- Targeting confirmation
- Optimization goal confirmation

---

### Create Ad from Dashboard
**Endpoint:** `POST /act_{ad_account_id}/ads`

**Parameters:**
```json
{
  "name": "Ad name",
  "adset_id": "adset_id",
  "creative": {
    "title": "Ad title",
    "body": "Ad body text",
    "image_hash": "image_id"
  },
  "status": "PAUSED|ACTIVE"
}
```

**Results Shown:**
- Ad ID
- Creative confirmation
- Ad status
- Ad set assignment confirmation

---

## 6. User Workflow

### Step 1: Authentication & Setup
1. User enters Meta Access Token
2. User enters Ad Account ID
3. User optionally enters Facebook Page ID
4. User optionally enters Instagram Account ID
5. User selects Industry/Niche
6. System validates token via `/me` endpoint

### Step 2: Data Analysis
1. System retrieves all campaigns via `/campaigns` endpoint
2. System retrieves 7-day insights via `/insights` endpoint
3. System retrieves ad sets via `/adsets` endpoint
4. System retrieves ads via `/ads` endpoint
5. System retrieves Facebook posts (if Page ID provided)
6. System retrieves Instagram media (if IG Account ID provided)

### Step 3: Content Strategy Generation
1. System analyzes gaps in campaign objectives
2. System generates niche-specific captions and hashtags
3. System builds 7-day content calendar
4. System reviews ad creatives and assigns performance scores
5. System generates content category recommendations

### Step 4: Dashboard Display
1. Campaign Performance tab shows all metrics
2. Content Strategy tab displays gaps, captions, hashtags, categories
3. Content Calendar tab displays 7-day schedule
4. Ad Creative Review tab shows individual ad analysis

### Step 5: Publishing (Optional)
1. User clicks "Post to Facebook" or "Post to Instagram"
2. Modal displays pre-filled caption from recommendations
3. Modal shows API payload for confirmation
4. User confirms posting
5. System sends POST request to appropriate endpoint
6. System displays success/error with post ID

---

## 7. API Rate Limits & Quotas

### Meta Graph API Rate Limits
- **Campaign Data:** 200 calls per hour per user
- **Insights:** 200 calls per hour per user
- **Posts/Media:** 200 calls per hour per user
- **Ad Creation:** Limited by ad account tier

### Batch Limits
- Max campaigns per request: 1000
- Max insights fields per request: 250
- Pagination: 25-100 items per page

### Recommendations
- Implement caching for insights data
- Cache campaign lists for 5-10 minutes
- Limit real-time refresh to once per minute

---

## 8. Error Handling & Responses

### API Error Responses
```json
{
  "error": {
    "message": "Error description",
    "type": "OAuthException|GraphMethodException",
    "code": "error_code"
  }
}
```

### Common Errors Displayed
- Invalid access token
- Insufficient permissions
- Account not found
- Rate limit exceeded
- Network timeout

### User Feedback
- Status messages in real-time
- Error alerts with actionable next steps
- Success confirmations with IDs
- Loading indicators during API calls

---

## 9. Data Persistence

### Browser Storage
- Draft saving via localStorage
- Campaign data stored in session
- Content strategy cached during session
- Cleared on browser refresh

### Export Functionality
- CSV export of campaigns and metrics
- Text export of content strategy report
- PDF download option for complete report

---

## 10. Security Considerations

### Token Security
- Access token required for all API calls
- Token validated before data retrieval
- No token logged or stored permanently
- User responsible for token security

### Permissions
- Minimum required permissions enforced
- Page access tokens preferred over user tokens
- Instagram publishing requires explicit permissions
- Token expiration should be monitored

### CORS & Cross-Domain
- Meta API accessible from browser (CORS enabled)
- All requests go directly to Meta Graph API
- No proxy required for token-based auth

---

## 11. Results & Display Format

### Campaign Performance Results
| Element | Format | Update Frequency |
|---------|--------|------------------|
| Spend | Currency ($) | Real-time |
| CTR | Percentage (%) | Real-time |
| CPC | Currency ($) | Real-time |
| CPM | Currency ($) | Real-time |
| Impressions | Numbers | Real-time |
| Status | Badge (Active/Paused) | Real-time |

### Content Strategy Results
| Element | Format | Static/Dynamic |
|---------|--------|----------------|
| Content Gaps | List with explanations | Dynamic based on campaigns |
| Captions | 5 pre-written examples | Static per niche |
| Hashtags | 12 clickable tags | Static per niche |
| Content Categories | % breakdown | Static per niche |
| Content Calendar | 7-day grid | Static template |

### Posting Results
| Action | Response | Display |
|--------|----------|---------|
| Post to Facebook | Post ID | Success modal with link |
| Post to Instagram | Media ID | Success modal with confirmation |
| Create Campaign | Campaign ID | Success modal with ID |
| Create Ad Set | Ad Set ID | Success modal with ID |
| Create Ad | Ad ID | Success modal with ID |

---

## 12. Integration Points

### Frontend
- HTML5 interface with responsive design
- Real-time status updates
- Modal confirmations before posting
- Tab-based navigation

### Backend (No Backend Required)
- Direct browser-to-API communication
- Client-side data processing
- Client-side content generation
- No server needed for basic operation

### Optional Backend Enhancement
- Token refresh service
- Rate limit management
- Data caching layer
- Scheduled report generation

---

## 13. Feature Summary

### What Users Can Do
✅ View all campaign metrics (spend, impressions, CTR, CPC, CPM)
✅ Analyze content gaps in campaign strategy
✅ Get niche-specific caption recommendations
✅ Browse trending hashtags
✅ View content category breakdowns
✅ See 7-day content calendar with optimal posting times
✅ Review individual ad creatives with performance scores
✅ Post directly to Facebook from the tool
✅ Publish directly to Instagram from the tool
✅ Create new campaigns
✅ Create new ad sets
✅ Create new ads
✅ Export data as CSV
✅ Generate and download reports
✅ Save draft analysis

### What Users Cannot Do
❌ Edit existing campaign budgets (view-only)
❌ Delete campaigns (must use Meta Ads Manager)
❌ Modify ad creatives (view-only analysis)
❌ Change campaign targeting (must use Meta Ads Manager)

---

## 14. Testing Checklist for Developer

- [ ] Meta API v23.0 endpoints functional
- [ ] Token validation works correctly
- [ ] Campaign data retrieves successfully
- [ ] Insights data displays with 7-day aggregation
- [ ] Ad sets and ads retrieve properly
- [ ] Facebook posts endpoint functional
- [ ] Instagram media endpoint functional
- [ ] Direct posting to Facebook works
- [ ] Direct publishing to Instagram works
- [ ] Create campaign endpoint functional
- [ ] Create ad set endpoint functional
- [ ] Create ad endpoint functional
- [ ] Error handling for invalid tokens
- [ ] Error handling for rate limits
- [ ] CSV export includes all data
- [ ] Report generation complete
- [ ] Modal confirmations display payload
- [ ] Budget metrics display accurately
- [ ] Content strategy matches selected niche
- [ ] Calendar displays 7 days with optimal times

---

## 15. Deployment Notes

### Production Readiness
- [ ] Implement backend token refresh endpoint
- [ ] Add database for analytics history
- [ ] Set up rate limit monitoring
- [ ] Configure error logging
- [ ] Add authentication layer (optional)

### Environment Setup
- Meta App ID required
- Test token with sandbox environment first
- Verify all permissions before production
- Monitor API quotas and limits
- Implement caching for optimal performance

---

## References

- Meta Graph API Documentation: https://developers.facebook.com/docs/graph-api
- Meta Marketing API: https://developers.facebook.com/docs/marketing-api
- Instagram Graph API: https://developers.facebook.com/docs/instagram-graph-api
- Permissions Reference: https://developers.facebook.com/docs/permissions/reference

---

**Document Version:** 1.0
**Last Updated:** 2024
**Status:** Ready for Developer Implementation
