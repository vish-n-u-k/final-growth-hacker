# Google Login Setup Guide

## What I've Added

1. **Google OAuth Button** - Added to both `/login` and `/signup` pages
2. **OAuth Handler Function** - `handleGoogleSignIn` in both auth pages
3. **OAuth Callback Route** - New route at `/auth/callback` to handle Google's redirect

## Configuration Steps

### Step 1: Enable Google Provider in Supabase

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project (Growth Tracker)
3. Navigate to **Authentication > Providers**
4. Find **Google** and click to enable it
5. You'll see a callback URL (should be something like `https://vdxuebfzphbzwshitqsf.supabase.co/auth/v1/callback`)

### Step 2: Set Up Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API**
4. Go to **Credentials** > **Create Credentials** > **OAuth Client ID**
5. Choose **Web application**
6. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://yourdomain.com/auth/callback` (for production)
7. Copy the **Client ID** and **Client Secret**

### Step 3: Add Credentials to Supabase

1. In Supabase, under Authentication > Providers > Google:
2. Paste the **Client ID**
3. Paste the **Client Secret**
4. Click **Save**

## How It Works

- Users click the "Continue with Google" button
- They're redirected to Google's login
- After successful authentication, Google redirects to `/auth/callback`
- The callback route exchanges the code for a Supabase session
- User is redirected to `/dashboard`

## Testing

1. Start your dev server: `npm run dev`
2. Go to http://localhost:3000/login or /signup
3. Click "Continue with Google"
4. You should be able to sign in with your Google account

## Notes

- The Google button uses the same styling as your existing buttons
- Both email/password and Google authentication are supported
- Users can use either method to sign in
- If a user signs up with Google but later tries email/password with the same email, Supabase handles this appropriately
