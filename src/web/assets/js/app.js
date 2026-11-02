import { $, show } from './dom.js';
import { parseInvite } from './invite.js';
import { initLanding, initPrejoin } from './landing.js';
// BUG! i split the monolithic app.js into a bunch of sub children
// Though whatever claude made was... Well it was kinda unmaintainable now all ive done is move around the code rlly
 
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
  show('ended');
  $('#endedTitle').textContent = 'HTTPS required';
  $('#endedMsg').textContent = 'Open this page over HTTPS (or on localhost). Browsers block camera, microphone and encryption on insecure pages.';
  $('#rejoinBtn').hidden = true;
} else {
  window.addEventListener('hashchange', () => location.reload());
  const invite = parseInvite();
  if (invite) {
    initPrejoin(invite);
  } else if (location.pathname === '/j') {
    show('ended');
    $('#endedTitle').textContent = 'Invalid link';
    $('#endedMsg').textContent = 'This invite link is incomplete or malformed. Make sure you copied all of it.';
    $('#rejoinBtn').hidden = true;
  } else {
    initLanding();
  }
}
