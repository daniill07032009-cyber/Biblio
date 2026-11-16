# Biblio Gmail relay (Google Apps Script)

This relay lets the Render application send verification mail through the Gmail account `bibliomail2026@gmail.com` over HTTPS. No VPS, SMTP port, or Gmail App Password is needed.

## Configure Google Apps Script

1. Sign in to [Google Apps Script](https://script.google.com/) as `bibliomail2026@gmail.com`.
2. Create a project and replace the contents of `Code.gs` with the file in this folder.
3. Open **Project Settings → Script properties → Add script property**:
   - Property: `BIBLIO_RELAY_SECRET`
   - Value: generate a random secret with at least 32 random bytes. Do not commit it or send it in chat.
4. Click **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
5. Authorize the app when Google asks. Copy the Web app URL ending in `/exec`.

## Configure Render

Add these environment variables to the Biblio service:

- `GMAIL_SCRIPT_URL`: the deployed Web app URL ending in `/exec`.
- `GMAIL_SCRIPT_SECRET`: exactly the same random secret as the Script property.

Do not add a Gmail App Password. Do not place the secret in GitHub, source files, screenshots, or chat. After adding the variables, save and allow Render to redeploy.

## Verify

Register using an email address you can access. The app should send a six-digit code that expires after 10 minutes. Check the Render logs if delivery fails. Google Apps Script and Gmail have daily quotas, so this is suitable for an initial low-volume launch rather than unlimited bulk mail.

The PR can be merged only after CI passes and a real end-to-end test confirms receipt of the email.
