/* beyondGREEN Email Tracking - Outlook add-in (OnMessageSend).
   On Send: asks the ERP for a tracking token, then adds a hidden open pixel and
   tracked byndgrn.com / beyondgreenbiotech.com links to the email.
   It never blocks a send: any problem and the email goes out untracked. */
/* global Office */
var BG_API = 'https://beyondgreen-erp.vercel.app/api/track/outlook-send';
var BG_TRACK = 'https://tdhqucirvetvjpfsmnfb.supabase.co/functions/v1/t';

function bgP(call) {
  return new Promise(function (resolve) {
    try { call(function (r) { resolve(r); }); } catch (e) { resolve({ status: 'failed' }); }
  });
}
function bgList(r) {
  var v = (r && r.status === 'succeeded' && r.value) ? r.value : [];
  return v.map(function (x) { return { email: String(x.emailAddress || '').toLowerCase(), name: x.displayName || '' }; });
}

function onMessageSendHandler(event) {
  var finished = false;
  function done() { if (finished) return; finished = true; event.completed({ allowEvent: true }); }
  // Hard stop so a slow network never holds up a send.
  setTimeout(done, 15000);

  (async function () {
    try {
      var item = Office.context.mailbox.item;
      var from = String((Office.context.mailbox.userProfile && Office.context.mailbox.userProfile.emailAddress) || '').toLowerCase();
      var res = await Promise.all([
        bgP(function (cb) { item.to.getAsync(cb); }),
        bgP(function (cb) { item.cc.getAsync(cb); }),
        bgP(function (cb) { item.subject.getAsync(cb); }),
        bgP(function (cb) { item.body.getTypeAsync(cb); })
      ]);
      if (res[3].status !== 'succeeded' || res[3].value !== Office.CoercionType.Html) return done();

      var resp = await fetch(BG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, to: bgList(res[0]), cc: bgList(res[1]), subject: (res[2] && res[2].value) || '' })
      });
      var j = await resp.json();
      if (!j || !j.track || !j.token) return done();

      var px = '<img src="' + BG_TRACK + '/o/' + j.token + '.gif" width="1" height="1" alt="" style="width:1px;height:1px;border:0">';
      var body = await bgP(function (cb) { item.body.getAsync(Office.CoercionType.Html, cb); });
      if (body.status !== 'succeeded') return done();
      var html = String(body.value || '');

      // Emails with pasted (inline) images: only append the pixel, never rewrite the body.
      if (/src=["']?cid:/i.test(html)) {
        if (item.body.appendOnSendAsync) {
          await bgP(function (cb) { item.body.appendOnSendAsync(px, { coercionType: Office.CoercionType.Html }, cb); });
        }
        return done();
      }

      // Drop tracker pixels from older quoted emails in the thread, so old messages don't count as new opens.
      html = html.replace(/<img[^>]*functions\/v1\/t\/o\/[^>]*>/gi, '');
      // Track clicks on our own website links.
      html = html.replace(/href=(["'])(https:\/\/(?:www\.)?(?:byndgrn\.com|beyondgreenbiotech\.com)[^"']*)\1/gi, function (m, q, u) {
        return 'href=' + q + BG_TRACK + '/c/' + j.token + '?u=' + encodeURIComponent(u) + q;
      });
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, px + '</body>') : html + px;
      await bgP(function (cb) { item.body.setAsync(html, { coercionType: Office.CoercionType.Html }, cb); });
      done();
    } catch (e) {
      done();
    }
  })();
}

Office.onReady(function () {});
if (Office.actions && Office.actions.associate) {
  Office.actions.associate('onMessageSendHandler', onMessageSendHandler);
}
