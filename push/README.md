# Exam Hub push

Mały Cloudflare Worker, który raz dziennie wysyła przypomnienie o nauce (Web Push) o godzinie wybranej w aplikacji. Przechowuje tylko subskrypcje push (adres usługi push przeglądarki, klucze, godzinę, strefę czasową, dni tygodnia) w KV. Nie wie nic o pytaniach: tekst powiadomienia dopasowuje service worker strony.

Drugie zadanie: logowanie przez GitHub i synchronizacja postępów nauki między urządzeniami (baza D1). Dla zalogowanych zapisuje: numeryczne id GitHub, login, nazwę wyświetlaną, adres URL awatara oraz postępy (wpisy `study:*`, `exam-history:*`, motyw). Tokenu GitHub nie zapisuje: używa go raz do odczytu publicznego profilu (bez dodatkowych uprawnień) i zapomina. Tokeny sesji i kody jednorazowe trzyma tylko jako skróty SHA-256. `DELETE /account` usuwa wszystko o użytkowniku.

Działa na darmowym planie Cloudflare. Cron uruchamia się co 15 minut.

## Jednorazowa konfiguracja

Wszystkie polecenia uruchamiasz w folderze `push/`.

1. Zaloguj się do Cloudflare:
   ```
   npx wrangler login
   ```
2. Utwórz magazyn KV:
   ```
   npx wrangler kv namespace create SUBS
   ```
   Skopiuj wypisane `id` do `wrangler.toml` w miejsce `REPLACE_WITH_KV_NAMESPACE_ID`.
3. Wygeneruj klucze VAPID:
   ```
   node scripts/gen-vapid.mjs
   ```
   Skrypt tylko wypisuje klucze na ekran, niczego nie zapisuje.
4. Wklej `VAPID_PUBLIC_KEY` do `wrangler.toml` w miejsce `REPLACE_WITH_VAPID_PUBLIC_KEY`.
5. Zapisz klucz prywatny jako sekret (wklej go, gdy wrangler poprosi):
   ```
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```
   Klucza prywatnego nigdy nie wpisuj do żadnego pliku w repo (repo jest publiczne).
6. Wdróż:
   ```
   npx wrangler deploy
   ```
7. Wrangler wypisze adres, np. `https://exam-hub-push.<subdomena>.workers.dev`. Wklej go do `assets/push-config.js` w repo strony:
   ```js
   self.PUSH_URL = "https://exam-hub-push.<subdomena>.workers.dev";
   ```

### Logowanie i synchronizacja

1. Utwórz bazę D1 i wklej wypisane `database_id` do `wrangler.toml` w miejsce `REPLACE_WITH_D1_ID`:
   ```
   npx wrangler d1 create exam-hub
   ```
2. Utwórz tabele:
   ```
   npx wrangler d1 migrations apply exam-hub --remote
   ```
3. Na GitHubie: Settings → Developer settings → OAuth Apps → New OAuth App. Homepage URL `https://michal1803.github.io/certs/`, Authorization callback URL:
   ```
   https://exam-hub-push.michaw49.workers.dev/auth/callback
   ```
   Wklej `Client ID` do `wrangler.toml` w miejsce `REPLACE_WITH_GITHUB_CLIENT_ID`.
4. Zapisz sekrety (wklej, gdy wrangler poprosi):
   ```
   npx wrangler secret put GITHUB_CLIENT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   npx wrangler secret put SESSION_SECRET
   ```
   Jako `SESSION_SECRET` wklej losowy ciąg z polecenia `node`. Jego zmiana unieważnia tylko trwające logowania, nie sesje.
5. Wdróż ponownie: `npx wrangler deploy`.

Zmiana kluczy VAPID unieważnia wszystkie istniejące subskrypcje (użytkownicy muszą włączyć przypomnienia ponownie).

## Zmienne

| Nazwa | Rodzaj | Zawartość |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | zmienna w `wrangler.toml` | base64url, nieskompresowany punkt P-256 (65 bajtów) |
| `VAPID_PRIVATE_KEY` | sekret (`wrangler secret put`) | base64url, surowy 32-bajtowy skalar `d` klucza P-256 (nie JWK, nie PEM) |
| `VAPID_SUBJECT` | zmienna w `wrangler.toml` | adres strony, `https://michal1803.github.io/certs/` |
| `SUBS` | KV | subskrypcje, klucz = SHA-256 (hex) adresu endpointu |
| `GITHUB_CLIENT_ID` | zmienna w `wrangler.toml` | Client ID aplikacji OAuth GitHub |
| `GITHUB_CLIENT_SECRET` | sekret | Client secret aplikacji OAuth GitHub |
| `SESSION_SECRET` | sekret | losowy klucz HMAC podpisujący parametr `state` logowania |
| `DB` | D1 (`exam-hub`) | użytkownicy, sesje, kody jednorazowe, postępy (`migrations/`) |
| `GITHUB_OAUTH_BASE`, `GITHUB_API_BASE` | tylko `.dev.vars` | adres udawanego GitHuba przy testach lokalnych |
| `ALLOW_INSECURE_ENDPOINTS` | tylko `.dev.vars` | `1` pozwala na endpointy `http://localhost` przy testach lokalnych |

## API

- `GET /vapid` → `{ "publicKey": "..." }`
- `POST /subscribe` `{ "subscription": PushSubscription.toJSON(), "time": "HH:MM", "tz": "Europe/Warsaw", "days": [1,2,3,4,5,6,0] }` → `{ "ok": true }` (ponowne wywołanie aktualizuje godzinę i dni; `days` opcjonalne, domyślnie wszystkie)
  Przyjmowane są tylko endpointy znanych usług push (Google FCM, Mozilla, Apple, Microsoft WNS), żeby Workera nie dało się użyć do wysyłania zapytań pod dowolny adres.
- `POST /unsubscribe` `{ "endpoint": "..." }` → `{ "ok": true }`
- `POST /test` `{ "endpoint": "..." }` → wysyła jedno powiadomienie od razu; najwyżej raz na 60 s. Błędy: 404 (brak subskrypcji), 429 (za często), 410 (subskrypcja wygasła i została usunięta).

### Logowanie i synchronizacja

1. Strona otwiera `GET /auth/login?return=<adres strony>` (tylko `https://michal1803.github.io/certs/...` albo `http://localhost:*`, inaczej 400). Worker przekierowuje do GitHuba, a GitHub z powrotem na `/auth/callback`.
2. Po sukcesie Worker przekierowuje na `<return>#auth=<kod>` (kod ważny 2 minuty, jednorazowy), po błędzie na `<return>#auth-error=<powód>` (np. `access_denied`).
3. `POST /auth/exchange` `{ "code": "..." }` → `{ "ok": true, "token": "...", "user": { "id", "login", "name", "avatar" } }`

Pozostałe wymagają nagłówka `Authorization: Bearer <token>`, inaczej 401 `{ "ok": false, "error": "unauthorized" }`. Sesja wygasa po 180 dniach bez użycia.

- `GET /me` → `{ "ok": true, "user": {...} }`
- `GET /sync` → `{ "ok": true, "items": { "<klucz>": { "value": "<tekst>", "updated": <ms> } } }`
- `PUT /sync` `{ "items": { "<klucz>": "<tekst>" } }` → `{ "ok": true, "updated": <ms> }`. 1–20 kluczy, klucz `study:<id>:v1`, `exam-history:<id>:v1` (`<id>` = `[a-z0-9-]{1,40}`) albo `exam-hub:theme`; wartość to tekst do 200 000 znaków; całe ciało do 1 MB.
- `POST /auth/logout` → usuwa bieżącą sesję.
- `DELETE /account` → usuwa postępy, sesje i konto.

## Test lokalny

Utwórz `push/.dev.vars` (jest w `.gitignore`) z kluczami z `node scripts/gen-vapid.mjs` i linią `ALLOW_INSECURE_ENDPOINTS=1`, potem:

Dla logowania dopisz `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` (dowolne wartości testowe) oraz `GITHUB_OAUTH_BASE`/`GITHUB_API_BASE` wskazujące na udawany serwer GitHub, i utwórz lokalną bazę:

```
npx wrangler d1 migrations apply exam-hub --local
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## Limity

Jedno uruchomienie crona wysyła najwyżej 45 powiadomień (limit 50 zapytań wychodzących na darmowym planie). KV na darmowym planie pozwala na 1000 zapisów dziennie: każde wysłane przypomnienie to jeden zapis. D1 na darmowym planie: 5 mln odczytanych i 100 tys. zapisanych wierszy dziennie; `PUT /sync` to jeden zapis na klucz, a sesja odświeża `last_used` najwyżej raz na dobę. Cron przy okazji usuwa wygasłe kody i sesje.
