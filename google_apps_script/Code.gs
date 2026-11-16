/**
 * Biblio transactional email relay.
 *
 * Setup:
 * 1. Create this project at https://script.google.com while signed in as
 *    bibliomail2026@gmail.com.
 * 2. In Project Settings > Script properties, add BIBLIO_RELAY_SECRET with
 *    the same high-entropy value configured as GMAIL_SCRIPT_SECRET in Render.
 * 3. Deploy > New deployment > Web app:
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. Copy the Web app URL ending in /exec to Render as GMAIL_SCRIPT_URL.
 *
 * The secret is checked by this script. Never put it in this source file.
 */
function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const expectedSecret = PropertiesService.getScriptProperties()
      .getProperty('BIBLIO_RELAY_SECRET') || '';
    const bodyText = e && e.postData && e.postData.contents
      ? e.postData.contents : '';
    if (!expectedSecret || bodyText.length > 12000) {
      return jsonResponse({ accepted: false, error: 'not_configured' });
    }

    const data = JSON.parse(bodyText);
    const suppliedSecret = String(data.secret || '');
    if (!constantTimeEquals_(suppliedSecret, expectedSecret)) {
      return jsonResponse({ accepted: false, error: 'unauthorized' });
    }

    const recipient = String(data.to || '').trim();
    const subject = String(data.subject || '');
    const textBody = String(data.text || '');
    const htmlBody = String(data.html || '');
    if (!/^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$/.test(recipient) ||
        subject !== 'Подтверждение регистрации в Biblio' ||
        !/\b\\d{6}\b/.test(textBody) ||
        textBody.length > 3000 || htmlBody.length > 9000) {
      return jsonResponse({ accepted: false, error: 'invalid_request' });
    }

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: 'Biblio'
    });
    return jsonResponse({ accepted: true });
  } catch (error) {
    console.error('Biblio mail relay failed: ' + error.name);
    return jsonResponse({ accepted: false, error: 'send_failed' });
  }
}

function constantTimeEquals_(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}
