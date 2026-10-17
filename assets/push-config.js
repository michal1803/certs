/* Address of the push Worker (see push/README.md), e.g.
   "https://exam-hub-push.<subdomain>.workers.dev". Empty: push notifications
   are not offered and only the calendar reminder is shown. Uses `self`, so
   the page and the service worker can both read it. */
self.PUSH_URL = "https://exam-hub-push.michaw49.workers.dev";
