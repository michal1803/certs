# Exam Hub push

Mały Cloudflare Worker, który raz dziennie wysyła przypomnienie o nauce (Web Push) o godzinie wybranej w aplikacji. Przechowuje tylko subskrypcje push (adres usługi push przeglądarki, klucze, godzinę, strefę czasową, dni tygodnia) w KV. Nie wie nic o pytaniach: tekst powiadomienia dopasowuje service worker strony.

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

Zmiana kluczy VAPID unieważnia wszystkie istniejące subskrypcje (użytkownicy muszą włączyć przypomnienia ponownie).

## Zmienne

| Nazwa | Rodzaj | Zawartość |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | zmienna w `wrangler.toml` | base64url, nieskompresowany punkt P-256 (65 bajtów) |
| `VAPID_PRIVATE_KEY` | sekret (`wrangler secret put`) | base64url, surowy 32-bajtowy skalar `d` klucza P-256 (nie JWK, nie PEM) |
| `VAPID_SUBJECT` | zmienna w `wrangler.toml` | adres strony, `https://michal1803.github.io/certs/` |
| `SUBS` | KV | subskrypcje, klucz = SHA-256 (hex) adresu endpointu |
| `ALLOW_INSECURE_ENDPOINTS` | tylko `.dev.vars` | `1` pozwala na endpointy `http://localhost` przy testach lokalnych |

## API

- `GET /vapid` → `{ "publicKey": "..." }`
- `POST /subscribe` `{ "subscription": PushSubscription.toJSON(), "time": "HH:MM", "tz": "Europe/Warsaw", "days": [1,2,3,4,5,6,0] }` → `{ "ok": true }` (ponowne wywołanie aktualizuje godzinę i dni; `days` opcjonalne, domyślnie wszystkie)
  Przyjmowane są tylko endpointy znanych usług push (Google FCM, Mozilla, Apple, Microsoft WNS), żeby Workera nie dało się użyć do wysyłania zapytań pod dowolny adres.
- `POST /unsubscribe` `{ "endpoint": "..." }` → `{ "ok": true }`
- `POST /test` `{ "endpoint": "..." }` → wysyła jedno powiadomienie od razu; najwyżej raz na 60 s. Błędy: 404 (brak subskrypcji), 429 (za często), 410 (subskrypcja wygasła i została usunięta).

## Test lokalny

Utwórz `push/.dev.vars` (jest w `.gitignore`) z kluczami z `node scripts/gen-vapid.mjs` i linią `ALLOW_INSECURE_ENDPOINTS=1`, potem:

```
npx wrangler dev --local --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## Limity

Jedno uruchomienie crona wysyła najwyżej 45 powiadomień (limit 50 zapytań wychodzących na darmowym planie). KV na darmowym planie pozwala na 1000 zapisów dziennie: każde wysłane przypomnienie to jeden zapis.
