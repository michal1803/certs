# Exam Hub

Prywatna aplikacja do nauki. Strona jest serwowana przez Cloudflare Worker z `push/`
(za logowaniem GitHub, dostęp tylko dla właściciela): `cd push && npm run deploy`
kopiuje pliki strony do `push/dist/certs/` i wdraża Workera.

Pliki strony:

- `index.html` — ekran startowy (Nauka, Egzamin, Postęp)
- `terraform.html` — HashiCorp Terraform Associate 004
- `az104.html` — Microsoft AZ-104
- `privacy.html` — polityka prywatności
