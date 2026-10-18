# Exam Hub push

Mały Cloudflare Worker, który raz dziennie wysyła przypomnienie o nauce (Web Push) o godzinie wybranej w aplikacji. Przechowuje tylko subskrypcje push (adres usługi push przeglądarki, klucze, godzinę, strefę czasową, dni tygodnia) w KV. Nie wie nic o pytaniach: tekst powiadomienia dopasowuje service worker strony.

Drugie zadanie: logowanie przez GitHub i synchronizacja postępów nauki między urządzeniami (baza D1). Dla zalogowanych zapisuje: numeryczne id GitHub, login, nazwę wyświetlaną, adres URL awatara oraz postępy (wpisy `study:*`, `exam-history:*`, motyw). Tokenu GitHub nie zapisuje: używa go raz do odczytu publicznego profilu (bez dodatkowych uprawnień) i zapomina. Tokeny sesji i kody jednorazowe trzyma tylko jako skróty SHA-256. `DELETE /account` usuwa wszystko o użytkowniku. Konto nieużywane przez 24 miesiące cron usuwa sam (patrz [Przechowywanie danych](#przechowywanie-danych)).

Działa na darmowym planie Cloudflare. Cron uruchamia się co 15 minut.

## Jednorazowa konfiguracja

Wszystkie polecenia uruchamiasz w folderze `push/`. Najpierw zainstaluj przypiętą wersję wranglera z `package-lock.json` (folder `node_modules` jest w `.gitignore`), żeby `npx wrangler` używał zawsze tej samej wersji:
```
npm ci
```

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
2. Utwórz tabele (to samo polecenie wgrywa później nowe pliki z `migrations/`):
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
| `IP_HASH_SECRET` | sekret | osobny losowy klucz HMAC do dziennego licznika nowych subskrypcji na IP; bez niego ten licznik jest pomijany |
| `DB` | D1 (`exam-hub`) | użytkownicy, sesje, kody jednorazowe, postępy (`migrations/`) |
| `RL_AUTH`, `RL_PUSH`, `RL_API` | Rate Limiting (`[[ratelimits]]` w `wrangler.toml`) | limity zapytań, patrz [Limity](#limity); `namespace_id` to dowolna liczba unikalna w koncie Cloudflare |
| `GITHUB_OAUTH_BASE`, `GITHUB_API_BASE` | tylko `.dev.vars` | adres udawanego GitHuba przy testach lokalnych |
| `ALLOW_INSECURE_ENDPOINTS` | tylko `.dev.vars` | `1` pozwala na endpointy `http://localhost` przy testach lokalnych |
| `DEV_ORIGINS` | tylko `.dev.vars` | `1` dopuszcza strony z `http://localhost:*` i `http://127.0.0.1:*` (CORS i adres powrotu logowania); w produkcji nieustawiona, więc działa tylko `https://michal1803.github.io` |

## API

Odpowiedzi JSON mają `Cache-Control: no-store` (mogą zawierać dane użytkownika lub token). Po przekroczeniu limitu zapytań: 429 `{ "ok": false, "error": "rate limited" }` z nagłówkiem `Retry-After: 60`.

- `GET /vapid` → `{ "publicKey": "..." }`
- `POST /subscribe` `{ "subscription": PushSubscription.toJSON(), "time": "HH:MM", "tz": "Europe/Warsaw", "days": [1,2,3,4,5,6,0] }` → `{ "ok": true }` (ponowne wywołanie aktualizuje godzinę i dni; `days` opcjonalne, domyślnie wszystkie)
  Przyjmowane są tylko endpointy znanych usług push (Google FCM, Mozilla, Apple, Microsoft WNS), żeby Workera nie dało się użyć do wysyłania zapytań pod dowolny adres.
  Nowa subskrypcja (nie aktualizacja istniejącej) może dostać 503 `subscription limit reached` (w KV jest już 1000 subskrypcji) albo 429 `too many new subscriptions today` (z tego adresu IP dodano dziś już 5 nowych).
- `POST /unsubscribe` `{ "endpoint": "..." }` → `{ "ok": true }`
- `POST /test` `{ "endpoint": "..." }` → wysyła jedno powiadomienie od razu; najwyżej raz na 60 s. Błędy: 404 (brak subskrypcji), 429 (za często), 410 (subskrypcja wygasła i została usunięta).

### Logowanie i synchronizacja

1. Strona otwiera `GET /auth/login?challenge=<sha256 hex weryfikatora>&return=<adres strony>` (tylko `https://michal1803.github.io/certs/...`, a przy `DEV_ORIGINS=1` także `http://localhost:*` i `http://127.0.0.1:*`; inaczej 400). Worker przekierowuje do GitHuba, a GitHub z powrotem na `/auth/callback`.
2. Po sukcesie Worker przekierowuje na `<return>#auth=<kod>` (kod ważny 2 minuty, jednorazowy), po błędzie na `<return>#auth-error=<powód>` (np. `access_denied`).
3. `POST /auth/exchange` `{ "code": "...", "verifier": "..." }` → `{ "ok": true, "token": "...", "user": { "id", "login", "name", "avatar" } }`

Pozostałe wymagają nagłówka `Authorization: Bearer <token>`, inaczej 401 `{ "ok": false, "error": "unauthorized" }`. Sesja wygasa po 90 dniach bez użycia, a niezależnie od tego zawsze 180 dni po zalogowaniu (potem trzeba zalogować się ponownie).

- `GET /me` → `{ "ok": true, "user": {...} }`
- `GET /sync` → `{ "ok": true, "items": { "<klucz>": { "value": "<tekst>", "updated": <ms> } } }`
- `PUT /sync` `{ "items": { "<klucz>": "<tekst>" } }` → `{ "ok": true, "updated": <ms> }`. 1–20 kluczy, klucz `study:<id>:v1`, `exam-history:<id>:v1` (`<id>` = `az104` albo `terraform`) albo `exam-hub:theme`; wartość to tekst do 200 000 znaków; całe ciało do 1 MB.
- `POST /auth/logout` → usuwa bieżącą sesję: `{ "ok": true, "sessions": 1 }`.
- `POST /auth/logout?all=1` albo `POST /auth/logout-all` → wylogowuje ze wszystkich urządzeń (usuwa wszystkie sesje użytkownika, także bieżącą); `sessions` = liczba usuniętych.
- `DELETE /account` → usuwa postępy, sesje i konto.

## Test lokalny

Utwórz `push/.dev.vars` (jest w `.gitignore`) z kluczami z `node scripts/gen-vapid.mjs` i liniami `ALLOW_INSECURE_ENDPOINTS=1` oraz `DEV_ORIGINS=1` (strona z `http://localhost`), potem:

Dla logowania dopisz `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` (dowolne wartości testowe) oraz `GITHUB_OAUTH_BASE`/`GITHUB_API_BASE` wskazujące na udawany serwer GitHub, i utwórz lokalną bazę:

```
npx wrangler d1 migrations apply exam-hub --local
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## Limity

Jedno uruchomienie crona wysyła najwyżej 45 powiadomień (limit 50 zapytań wychodzących na darmowym planie). KV na darmowym planie pozwala na 1000 zapisów dziennie: każde wysłane przypomnienie to jeden zapis. D1 na darmowym planie: 5 mln odczytanych i 100 tys. zapisanych wierszy dziennie; `PUT /sync` to jeden zapis na klucz, a sesja odświeża `last_used` najwyżej raz na dobę. Cron przy okazji usuwa wygasłe kody i sesje.

Limity zapytań (Workers Rate Limiting, liczone osobno w każdej lokalizacji Cloudflare, więc przybliżone; okno 60 s):

| Powiązanie | Trasy | Limit |
| --- | --- | --- |
| `RL_AUTH` | `GET /auth/login`, `POST /auth/exchange` | 10 na minutę z jednego IP |
| `RL_PUSH` | `POST /subscribe`, `/unsubscribe`, `/test` | 10 na minutę z jednego IP |
| `RL_API` | `GET /me`, `GET`/`PUT /sync`, `POST /auth/logout*`, `DELETE /account` | 60 na minutę z jednego IP i osobno 60 na minutę na użytkownika |

Bez powiązań (np. stara konfiguracja lokalna) limity są po prostu pomijane. `GET /vapid` i `/auth/callback` (wymaga podpisanego `state` z `/auth/login`) nie mają limitu.

Subskrypcje: najwyżej 1000 w KV i najwyżej 5 nowych dziennie z jednego IP (liczniki w D1, tabele `stats` i `sub_quota`; IP zapisany tylko jako skrót SHA-256 z solą, usuwany następnego dnia; bez D1 te limity są pomijane). Cron po każdym przebiegu zapisuje dokładną liczbę subskrypcji. Subskrypcja jest usuwana od razu po odpowiedzi 404/410 usługi push, a po 400/403 dopiero po 3 takich odpowiedziach z rzędu (udane wysłanie zeruje licznik).

## Przechowywanie danych

- Sesja: najwyżej 90 dni bez użycia i najwyżej 180 dni od zalogowania; wygasłe sesje cron usuwa z bazy.
- Konto: cron usuwa użytkowników bez aktywności (logowanie albo dowolne zapytanie z tokenem; `last_seen` odświeżane najwyżej raz na dobę) przez 24 miesiące razem z ich postępami, sesjami i kodami.
- Subskrypcje push: do wypisania się albo do odrzucenia przez usługę push (wyżej).

## Wdrożenie zmian

```
npm ci
npx wrangler d1 migrations apply exam-hub --remote
npx wrangler deploy
```

Najpierw migracje, potem kod (nowy kod korzysta z tabel i indeksów z `migrations/0003_limits_retention.sql`).

## Ochrona logowania

Kod logowania jest powiązany z przeglądarką, która zaczęła logowanie: strona trzyma losowy weryfikator i wysyła tylko jego skrót (`challenge`). Bez weryfikatora kodu nie da się wymienić na sesję, więc cudzy link logowania nie zaloguje nikogo na obce konto. Klucze synchronizacji są ograniczone do istniejących egzaminów.
