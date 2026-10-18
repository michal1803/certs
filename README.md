# Exam Hub

Prywatna aplikacja do nauki, pod adresem https://michal1803.github.io/certs/.

Strony w repo nie zawierają pytań. Bank pytań leży poza gitem (`push/bank/*.html`)
i jest wydawany przez Cloudflare Worker z `push/` (`GET /bank/<egzamin>`) tylko
sesji konta GitHub właściciela; `assets/bank.js` wstawia go na stronę po zalogowaniu.
Wdrożenie Workera razem z bankiem: `cd push && npm run deploy`.

Pliki strony:

- `index.html` — ekran startowy (Nauka, Egzamin, Postęp)
- `terraform.html` — HashiCorp Terraform Associate 004
- `az104.html` — Microsoft AZ-104
- `privacy.html` — polityka prywatności
