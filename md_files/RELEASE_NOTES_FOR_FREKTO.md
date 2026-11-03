# How to write release notes that Frekto can turn into posts

**For Claude (or any AI) helping write this product's GitHub releases and pull request descriptions.**

**Why this matters.** Frekto reads this repository's GitHub releases and merged pull requests and turns them into social media posts: images, carousels and short videos. It uses the words and screenshots exactly as you write them. So write every release as if its customers will read it, because they will.

Follow every rule below. If something you'd need is missing (a screenshot, a plain description of a change), ask the person you're working with rather than guessing.

---

## 1. Who you are writing for

- **Customers of this product, not developers.** They don't know the code, the tools or the team's internal names.
- They read on a phone, in a feed, for 2 seconds. **Short and plain wins.**
- Say what they can now **do**, or what got **better for them**, not what changed in the code.

| Don't write | Write |
|---|---|
| Refactored export service, added CSV serializer | Download your leads as a spreadsheet |
| Reduced payload in lead card component | Leads now take 5 seconds to read |
| Fix overflow on textarea in compose view | Long emails no longer get cut off |

## 2. The five kinds of update worth posting

Every highlight in a release should be one of these. Name the kind at the start of the highlight (see the template in section 4).

1. **New:** a new feature or tool. It tells people there's something new they can do now.
2. **Improved:** an improvement people will feel. Lead with the benefit, ideally with a number ("5 seconds", "half the clicks").
3. **You asked:** a change that came from customer feedback. Quote the feedback in plain words (no names, unless the person agreed), then say what you did.
4. **Multi feature update:** a release with several smaller changes. Each gets one short line, and Frekto turns them into one post with a slide each.
5. **Before and after:** an improvement that is easiest to see. Give one screenshot of before and one of after (see section 5).

A release can mix them, e.g. one **New** highlight plus a few smaller **Improved** and **Fixed** lines.

## 3. Never put these in a release or PR description

1. **Changes users can't see:** refactors, tests, dependency updates, CI, typos. Leave them out, or put them only under "Internal" at the very end, which is never posted.
2. **Anything not released to all users yet:** features behind a flag, in beta or in early access. Merged isn't the same as available.
3. **Technical wording:** file names, function names, PR titles like `fix: null check`, internal codenames, vendor or tool names, AI model names.
4. **Security fixes:** don't describe the problem. If needed, write only "Security improvements".
5. **Embarrassing bugs or outages:** don't write lines that mainly show how broken something was ("Fixed: all emails were being sent twice"). Say what works now.
6. **Real customer data:** names, emails, companies, numbers from real accounts, in text or screenshots.
7. **Promises and dates:** "coming next week", "soon", roadmap items.
8. **Anything that may be rolled back:** if unsure, leave it for the next release.
9. **Secrets and internals:** API keys, tokens, internal URLs, admin screens, staging addresses.

## 4. The release template

Use this structure for every GitHub release. Keep the headings exactly as written.

```markdown
## <Title: the main benefit, max 70 characters>

<Summary: one sentence on what changed for customers, max 160 characters.>

### Highlights

**New: <feature name, max 60 characters>**
<1–2 plain sentences: what you can do now and why it helps. Max 160 characters.>
**Why it matters:** <one line, max 100 characters>

![<what the screenshot shows, in plain words>](<image link>)

**Improved: <change, max 60 characters>**
<1–2 sentences.>

![Before: <what it shows>](<image link>)
![After: <what it shows>](<image link>)

### New
- <one line per item, max 60 characters>

### Improved
- <one line per item, max 60 characters>

### Fixed
- <one line per item, max 60 characters, saying what works now>

### Action needed
- <only if customers must do something, e.g. reconnect an account. Delete this section otherwise.>

### Internal
- <optional, never posted: refactors, dependencies, tests>
```

**Rules for the template**
- **Title:** the benefit, not the version number. Put the version in the GitHub release name or tag (e.g. `v1.4.0`), not in the title line.
- **Highlights:** 1–3 per release. Every highlight has a screenshot (section 5).
- **New / Improved / Fixed lists:** 2–6 lines in total is ideal. Each line starts with the feature's name when that helps ("Lead Finder: …").
- **Count characters.** Lines longer than the limits are cut or refused when posts are made.
- **No emoji, no exclamation marks, no hype words** ("revolutionary", "game-changing", "supercharge").
- If a release has **nothing customers would notice**, write only: `No customer-facing changes in this release.` That release won't become a post.

## 5. Screenshots and screen recordings

Frekto puts screenshots into image and carousel posts, and uses screen recordings and screenshots to make short videos. A highlight without a picture makes a weaker post.

**What to include**
- **Every highlight:** at least one screenshot of the feature.
- **The main New highlight:** if possible, also a short **screen recording** (5–20 seconds, MP4 or GIF) of someone using it, from first click to result.
- **Before and after:** two screenshots with the **same size, crop and data**, labelled `Before:` and `After:` in their alt text, in that order.
- **Multi feature update:** one screenshot per item if you have them. Items without one are fine.

**How to take them**
- **Crop to the feature.** Show the part of the screen that changed plus a little context. No browser tabs, bookmarks bar, desktop or notifications.
- **Use demo data only:** a sample account with made-up but realistic names, companies and numbers. Don't blur real data; replace it with demo data.
- **Make it sharp:** at least 1600 px wide for desktop screens (take it on a high-resolution screen or zoom the browser to 125–150%). Phone screens: a real phone screenshot, portrait.
- **Pick the shape for the screen:** desktop features in a wide or roughly 4:5 crop; mobile features in portrait (9:16).
- **Keep the look the same in every release:** the same theme (light or dark), the same browser window size, the same demo account.
- **Show it working, not empty:** a filled list, a finished result, not a loading spinner or a blank state.
- **Recordings:** move the mouse slowly, no typing mistakes, cut the dead time at the start and end, no sound needed.

**How to add them**
- Drag the image or video into the GitHub release editor (or the PR description). GitHub uploads it and inserts the link.
- **Write alt text** that says what the picture shows in plain words: `![Lead list with the Download leads link at the top](…)`. Frekto and screen readers both use it.
- Put each screenshot **directly under the highlight it belongs to**, never all at the bottom.
- **Private repositories:** open each image link in a logged-out browser window. If it doesn't open, host the image somewhere public and use that link instead.

**If you're the AI writing the notes and have no screenshots:** list exactly which screenshots or recordings are needed (what screen, what state, what data) and ask the person to add them before publishing. Never invent image links.

## 6. Pull request descriptions

Merged pull requests can also become posts, so customer-facing PRs need a short section for customers. Add this at the end of the PR description:

```markdown
## For customers
**<New | Improved | Fixed>: <one line, max 60 characters>**
<One plain sentence on what customers can do now.>

![<what it shows>](<image link>)
```

- Leave this section out of PRs customers won't notice (refactors, tests, dependencies, CI).
- Labels help choose what goes into a release: `feature`, `improvement`, `fix`, and `skip-changelog` for internal work.

Optional: let GitHub sort labelled PRs into sections automatically with `.github/release.yml`:

```yaml
changelog:
  exclude:
    labels: [skip-changelog]
  categories:
    - title: New
      labels: [feature]
    - title: Improved
      labels: [improvement]
    - title: Fixed
      labels: [fix]
```

GitHub's automatic list uses PR titles, so rewrite those lines in plain words before publishing (section 1).

## 7. A finished example

```markdown
## Download your leads in one click

Take your whole lead list to a spreadsheet or your CRM, with names, emails and priority.

### Highlights

**New: Download your leads**
One click saves every open lead as a spreadsheet, ready for your CRM.
**Why it matters:** no more copying leads one by one.

![Lead list with the Download leads link in the top line](https://github.com/user-attachments/assets/…)

**Improved: Leads you can judge in 5 seconds**
Every lead now shows one line on why it fits and four short facts.

![Before: a lead with long paragraphs of notes](https://github.com/user-attachments/assets/…)
![After: the same lead with one line and four short facts](https://github.com/user-attachments/assets/…)

### Improved
- First emails are shorter: under 60 words
- Lead list shows how many leads are left

### Fixed
- Long emails no longer get cut off in the editor

### Internal
- Moved lead export into its own module
```

## 8. Check before publishing

- [ ] The title says a benefit and is 70 characters or fewer.
- [ ] Every line is plain words a customer understands, with no code, tool or internal names.
- [ ] Every highlight has a screenshot with alt text, placed right under it.
- [ ] Screenshots use demo data, are cropped and sharp, and show the feature working.
- [ ] Before/after pairs match in size and crop, and are labelled.
- [ ] Nothing unreleased, no security details, no promises, no customer data.
- [ ] Lists are within the limits (lines of 60 characters or fewer, 2–6 items).
- [ ] Internal changes are only under "Internal", or left out.
